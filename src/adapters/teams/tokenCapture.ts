import crypto from "node:crypto";
import { teamsApiEndpoint, teamsProfileEndpoint } from "./teamsApiEndpoint";
import type { BrowserContext, Page } from "playwright";
import type { Logger } from "../../types";
import { type TeamsChatService, type TeamsTokenBundle } from "./teamsChatService";

export class TeamsTokenCapture {
  private readonly attachedPages = new WeakSet<Page>();

  constructor(
    private readonly chatService: TeamsChatService,
    private readonly logger: Logger
  ) {}

  private profileAuth?: { baseUrl: string; token: string; accountId: string; expiresAt?: number };

  private tokenIdentity(token: string) {
    try {
      const claims = JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString());
      const identity = typeof claims.oid === "string" ? `${claims.tid ?? ""}:${claims.oid}` : token;
      return {
        accountId: crypto.createHash("sha256").update(identity).digest("hex"),
        accountEmail: typeof claims.upn === "string" ? claims.upn : undefined,
        userId: typeof claims.oid === "string" ? claims.oid : undefined,
        expiresAt: typeof claims.exp === "number" ? claims.exp * 1000 : undefined
      };
    } catch {
      return { accountId: crypto.createHash("sha256").update(token).digest("hex") };
    }
  }

  private capture(urlString: string, headers: Record<string, unknown>): void {
    try {
      const normalized = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      const authorization = normalized.authorization;
      const bearer = typeof authorization === "string" && authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : undefined;
      const profileBase = teamsProfileEndpoint(urlString);
      if (profileBase && bearer) {
        this.profileAuth = { baseUrl: profileBase, token: bearer, ...this.tokenIdentity(bearer) };
        const existing = this.chatService.getToken();
        if (existing?.accountId === this.profileAuth.accountId && existing.profileToken !== bearer) {
          this.chatService.saveToken({ ...existing, profileApiBaseUrl: profileBase, profileToken: bearer, profileExpiresAt: this.profileAuth.expiresAt });
        }
      }
      const endpoint = teamsApiEndpoint(urlString);
      if (!endpoint) return;
      const raw = normalized["x-skypetoken"] ?? normalized.authentication;
      const skypeToken = typeof raw === "string" ? raw.replace(/^skypetoken=/i, "").trim() : "";
      const activeToken = endpoint.proxy ? bearer : skypeToken;
      if (!activeToken || activeToken.length <= 20) return;
      const identity = this.tokenIdentity(activeToken);
      const existing = this.chatService.getToken();
      if (existing?.accountId === identity.accountId && existing.apiBaseUrl === endpoint.baseUrl &&
        (endpoint.proxy ? existing.chatServiceToken : existing.skypeToken) === activeToken) return;
      const profile = this.profileAuth?.accountId === identity.accountId ? this.profileAuth : undefined;
      this.chatService.saveToken({
        ...identity, skypeToken: endpoint.proxy ? "" : skypeToken,
        chatServiceToken: endpoint.proxy ? bearer : undefined,
        apiBaseUrl: endpoint.baseUrl, region: endpoint.region,
        profileApiBaseUrl: profile?.baseUrl, profileToken: profile?.token, profileExpiresAt: profile?.expiresAt
      });
    } catch { /* Ignore unrelated or malformed network events. */ }
  }

  async inspectCookies(context: BrowserContext): Promise<string | undefined> {
    try {
      const cookies = await context.cookies("https://teams.microsoft.com/");
      const cookie = cookies.find((c) => c.name === "skypetoken_asm" && c.value);
      if (cookie && !this.chatService.hasValidToken()) {
        const token = cookie.value.replace(/^skypetoken=/i, "").trim();
        // A cookie has no regional endpoint; preserve the last observed region.
        this.chatService.saveToken({ ...this.tokenIdentity(token), skypeToken: token, expiresAt: cookie.expires > 0 ? cookie.expires * 1000 : undefined });
        return token;
      }
    } catch { /* Network capture may still succeed. */ }
    return undefined;
  }

  async attach(page: Page): Promise<void> {
    if (this.attachedPages.has(page)) return;
    this.attachedPages.add(page);
    page.on("request", (request) => this.capture(request.url(), request.headers()));
    try {
      const cdp = await page.context().newCDPSession(page);
      cdp.on("Network.requestWillBeSent", ({ request }) => this.capture(request.url, request.headers));
      page.once("close", () => { void cdp.detach().catch(() => undefined); });
      await cdp.send("Network.enable");
    } catch (error) {
      this.logger.debug("Could not attach CDP network listener", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await this.inspectCookies(page.context());
  }

  async waitForToken(timeoutMs = 5000): Promise<TeamsTokenBundle | undefined> {
    const start = Date.now();
    do {
      if (this.chatService.hasValidToken()) return this.chatService.getToken();
      await new Promise((resolve) => setTimeout(resolve, 250));
    } while (Date.now() - start < timeoutMs);
    return undefined;
  }
}
