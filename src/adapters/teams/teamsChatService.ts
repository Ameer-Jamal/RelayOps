import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { teamsApiEndpoint, teamsProfileEndpoint } from "./teamsApiEndpoint";
import type { Logger, MessageTarget } from "../../types";

export interface TeamsTokenBundle {
  skypeToken: string;
  region: string;
  chatServiceToken?: string;
  apiBaseUrl?: string;
  accountId?: string;
  accountEmail?: string;
  userId?: string;
  profileId?: string;
  profileApiBaseUrl?: string;
  profileToken?: string;
  profileExpiresAt?: number;
  bearerToken?: string;
  substrateToken?: string;
  expiresAt?: number;
  updatedAt: string;
}

export interface ConversationSummary {
  id: string;
  topic: string;
  threadType: string;
  lastMessageTime?: string | null;
  memberCount?: number | null;
  spaceId?: string;
}

export interface ChatMessageSummary {
  id: string;
  conversationId: string;
  content: string;
  from?: string;
  timestamp: string;
}

export class TeamsApiError extends Error {
  readonly code: "auth_required" | "permission_denied" | "rate_limited" | "api_error";
  constructor(readonly status: number) {
    const code = status === 401 ? "auth_required" : status === 403 ? "permission_denied" : status === 429 ? "rate_limited" : "api_error";
    super(status === 401 ? "Teams session expired or was rejected. Authenticate again."
      : status === 403 ? "Teams denied this API operation (HTTP 403). Check account access or your organization's policy."
      : status === 429 ? "Teams rate limit reached. Retry discovery later."
      : `Teams API request failed (HTTP ${status}).`);
    this.code = code;
  }
}

interface ConversationPage {
  conversations?: Array<{
    id: string;
    threadProperties?: Record<string, unknown>;
    properties?: Record<string, unknown>;
  }>;
  _metadata?: { backwardLink?: string; forwardLink?: string };
}

export class TeamsChatService {
  private cachedToken?: TeamsTokenBundle;
  readonly profileId: string;
  private readQueue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly stateDir: string,
    private readonly logger: Logger,
    profileDir?: string
  ) {
    this.profileId = crypto.createHash("sha256").update(path.resolve(profileDir ?? stateDir)).digest("hex");
    this.cachedToken = this.loadToken();
  }

  private tokenFilePath(): string {
    return path.join(this.stateDir, "teams-tokens.json");
  }

  loadToken(): TeamsTokenBundle | undefined {
    try {
      const filePath = this.tokenFilePath();
      if (!fs.existsSync(filePath)) {
        return undefined;
      }
      fs.chmodSync(filePath, 0o600);
      const raw = fs.readFileSync(filePath, "utf8");
      const parsed = JSON.parse(raw) as TeamsTokenBundle;
      if ((!parsed.skypeToken && !parsed.chatServiceToken) || parsed.profileId !== this.profileId) {
        return undefined;
      }
      this.cachedToken = parsed;
      return parsed;
    } catch (error) {
      this.logger.warn("Could not read cached Teams token bundle", {
        error: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  saveToken(token: Partial<TeamsTokenBundle> & { skypeToken: string }): TeamsTokenBundle {
    this.loadToken();
    const region = token.region || this.cachedToken?.region || "amer";
    const previous = token.accountId && token.accountId !== this.cachedToken?.accountId ? undefined : this.cachedToken;
    const bundle: TeamsTokenBundle = {
      ...previous,
      ...token,
      skypeToken: token.skypeToken,
      region,
      profileId: this.profileId,
      updatedAt: new Date().toISOString()
    };

    this.cachedToken = bundle;
    try {
      const filePath = this.tokenFilePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const temporaryPath = `${filePath}.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporaryPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
      fs.renameSync(temporaryPath, filePath);
      this.cachedToken = bundle;
      this.logger.info("Saved Teams token bundle to state", {
        region: bundle.region,
        hasBearer: Boolean(bundle.bearerToken),
        updatedAt: bundle.updatedAt
      });
    } catch (error) {
      this.logger.warn("Could not save Teams token bundle", {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return bundle;
  }

  getToken(): TeamsTokenBundle | undefined {
    return this.loadToken();
  }

  hasValidToken(): boolean {
    const token = this.getToken();
    return Boolean((token?.skypeToken || token?.chatServiceToken) && (!token.expiresAt || token.expiresAt > Date.now() + 30_000));
  }

  /**
   * Helper to resolve a MessageTarget to a Teams conversation ID:
   * 1. Check if target.url has a chat or channel link (e.g. /l/chat/48:notes/conversations or /l/channel/19:...)
   * 2. Check special names like "Me", "Myself", "Notes" -> 48:notes
   * 3. If cached/fetched conversations are provided, match by topic/label
   */
  resolveConversationId(
    target: MessageTarget,
    conversations?: ConversationSummary[]
  ): string | undefined {
    const raw = (target.url || target.label || target.name || "").trim();
    if (/^(?:19|48):[^\s/?#]+$/.test(raw)) return raw;
    if (/^https?:/i.test(raw)) {
      const parsed = new URL(raw);
      if (!/^(?:teams\.microsoft\.com|teams\.cloud\.microsoft)$/i.test(parsed.hostname)) {
        throw new Error("Expected a Microsoft Teams URL.");
      }
      const match = parsed.pathname.match(/\/l\/(?:chat|channel)\/([^/]+)/i);
      const id = parsed.searchParams.get("threadId") || (match ? decodeURIComponent(match[1]!) : "");
      if (/^(?:19|48):[^\s/?#]+$/.test(id)) return id;
      throw new Error("Teams URL has no conversation ID. Use a conversation ID or configured target.");
    }

    const label = (target.label || target.name || "").trim().toLowerCase();
    if (["me", "myself", "notes"].includes(label)) return "48:notes";
    const matches = conversations?.filter((c) => c.topic?.trim().toLowerCase() === label) ?? [];
    if (matches.length > 1) throw new Error("Ambiguous Teams target; use a conversation ID or URL.");
    if (matches.length === 1) return matches[0]!.id;

    return undefined;
  }

  apiBase(token: TeamsTokenBundle): string {
    const base = token.apiBaseUrl ?? this.chatServiceBase(token.region);
    const endpoint = teamsApiEndpoint(base);
    if (!endpoint || endpoint.baseUrl !== base) throw new Error("Invalid Teams API endpoint.");
    return base;
  }

  private chatServiceBase(region: string): string {
    const cleanRegion = (region || "amer").trim().toLowerCase();
    if (!/^[a-z0-9-]+$/.test(cleanRegion)) throw new Error("Invalid Teams region.");
    return `https://${cleanRegion}.ng.msg.teams.microsoft.com/v1`;
  }

  private authHeaders(token: TeamsTokenBundle): Record<string, string> {
    return {
      ...(token.chatServiceToken
        ? { Authorization: `Bearer ${token.chatServiceToken}` }
        : { Authentication: `skypetoken=${token.skypeToken}` }),
      "Content-Type": "application/json"
    };
  }

  /**
   * Send a rich message directly to a conversation via Teams Chat Service REST API.
   */
  async postMessage(
    target: MessageTarget,
    text: string,
    options?: { senderDisplayName?: string; token?: TeamsTokenBundle }
  ): Promise<{ success: boolean; messageId?: string; error?: string }> {
    const token = options?.token ?? this.getToken();
    if (!token) {
      return { success: false, error: "No Teams skypeToken available." };
    }

    let conversationId = this.resolveConversationId(target);
    if (!conversationId) {
      const conversations = await this.fetchConversations({ token, pageSize: 100 });
      conversationId = this.resolveConversationId(target, conversations);
    }
    if (!conversationId) {
      throw new Error("Could not resolve an exact Teams target. Use its conversation ID or URL.");
    }

    const baseUrl = this.apiBase(token);
    const url = `${baseUrl}/users/ME/conversations/${encodeURIComponent(conversationId)}/messages`;

    // Format content as HTML paragraph
    const formattedHtml = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .split("\n\n")
      .map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`)
      .join("");

    const payload = {
      content: formattedHtml,
      messagetype: "RichText/Html",
      contenttype: "text",
      clientmessageid: (BigInt(Date.now()) * 1000n + BigInt(crypto.randomInt(1000))).toString(),
      imdisplayname: options?.senderDisplayName ?? "RelayOps",
      properties: {
        importance: "",
        subject: null
      }
    };

    this.logger.info("Sending message via Teams Chat Service API", {
      conversationId,
      region: token.region,
      target: target.label ?? target.name
    });

    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      method: "POST",
      headers: this.authHeaders(token),
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      // Only an explicit authentication rejection is safe to retry through the browser.
      // A timeout or server failure may have delivered the message already.
      if (response.status === 401 || response.status === 403) {
        return { success: false, error: `Teams authentication rejected (HTTP ${response.status}).` };
      }
      throw new Error(`Teams send failed (HTTP ${response.status}); delivery is uncertain, so no automatic resend was attempted.`);
    }

    const data = (await response.json().catch(() => ({}))) as { id?: string; OriginalArrivalTime?: string };
    this.logger.info("Teams message sent successfully via Chat Service API", {
      conversationId,
      messageId: data.id
    });

    return {
      success: true,
      messageId: data.id
    };
  }

  /**
   * Fetch recent conversations from Teams Chat Service.
   */
  async fetchConversations(options?: {
    pageSize?: number;
    token?: TeamsTokenBundle;
  }): Promise<ConversationSummary[]> {
    const token = options?.token ?? this.getToken();
    if (!token) {
      throw new Error("No Teams skypeToken available.");
    }

    const pageSize = options?.pageSize ?? 30;
    const baseUrl = this.apiBase(token);
    const url = `${baseUrl}/users/ME/conversations?view=mychats&pageSize=${pageSize}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      method: "GET",
      headers: this.authHeaders(token)
    });

    if (!response.ok) {
      throw new TeamsApiError(response.status);
    }

    return this.summarizeConversations(await response.json() as ConversationPage);
  }

  private summarizeConversations(data: ConversationPage): ConversationSummary[] {
    const string = (value: unknown) => typeof value === "string" ? value.trim() : "";
    return (data.conversations ?? []).map((c) => ({
      id: c.id,
      topic: string(c.threadProperties?.topic) || string(c.threadProperties?.topicThreadTopic) || string(c.threadProperties?.spaceThreadTopic) || string(c.properties?.displayName),
      threadType: string(c.threadProperties?.threadType) || "chat",
      spaceId: string(c.threadProperties?.spaceId) || undefined,
      lastMessageTime: string(c.properties?.lastimreceivedtime) || null
    }));
  }

  private readRequest(url: string | URL, options: RequestInit): Promise<Response> {
    const operation = this.readQueue.catch(() => undefined).then(async () => {
      // Discovery can fan out over many rosters; serialize reads to avoid bursts.
      await new Promise((resolve) => setTimeout(resolve, 300));
      for (let attempt = 0; ; attempt++) {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(20_000), redirect: "error" });
        if (response.status !== 429 || attempt >= 2) return response;
        const raw = response.headers.get("retry-after");
        const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : undefined;
        const delay = seconds !== undefined ? seconds * 1000 : raw ? Date.parse(raw) - Date.now() : 2000;
        this.logger.warn("Teams discovery throttled; respecting retry delay", { attempt: attempt + 1, retryAfterMs: delay });
        if (!Number.isFinite(delay) || delay > 60_000) return response;
        await response.body?.cancel();
        await new Promise((resolve) => setTimeout(resolve, Math.max(1000, delay)));
      }
    });
    this.readQueue = operation;
    return operation;
  }

  async requestJson<T>(url: string, token = this.getToken()): Promise<T> {
    if (!token) throw new TeamsApiError(401);
    const base = this.apiBase(token);
    const parsed = new URL(url, base + "/");
    // Keep pagination and detail requests inside the captured API origin and path.
    if (!parsed.href.startsWith(base + "/") || parsed.username || parsed.password) {
      throw new Error("Refusing to send Teams credentials outside the captured API endpoint.");
    }
    const response = await this.readRequest(parsed, { headers: this.authHeaders(token) });
    if (!response.ok) throw new TeamsApiError(response.status);
    return await response.json() as T;
  }

  async fetchAllConversations(token: TeamsTokenBundle): Promise<{ conversations: ConversationSummary[]; complete: boolean }> {
    const base = this.apiBase(token);
    let url: string | undefined = `${base}/users/ME/conversations?view=mychats&pageSize=100`;
    const items = new Map<string, ConversationSummary>();
    const visited = new Set<string>();
    for (let page = 0; url && page < 50; page++) {
      if (visited.has(url)) return { conversations: [...items.values()], complete: false };
      visited.add(url);
      const data: ConversationPage = await this.requestJson(url, token);
      const rows = this.summarizeConversations(data);
      this.logger.debug("Teams directory page fetched", { page: page + 1, rows: rows.length, total: items.size + rows.length });
      const before = items.size;
      for (const row of rows) items.set(row.id, row);
      url = data._metadata?.backwardLink || undefined;
      if (url && items.size === before) return { conversations: [...items.values()], complete: false };
    }
    return { conversations: [...items.values()], complete: !url };
  }

  async fetchProfiles(ids: string[], token: TeamsTokenBundle): Promise<Array<{ id: string; displayName: string; email: string }>> {
    const base = token.profileApiBaseUrl;
    if (!base || !token.profileToken || (token.profileExpiresAt && token.profileExpiresAt <= Date.now())) {
      throw new Error("Teams profile authentication is unavailable. Refresh the browser session to discover people names.");
    }
    if (teamsProfileEndpoint(base + "/users/fetchShortProfile") !== base) throw new Error("Invalid Teams profile endpoint.");
    const response = await this.readRequest(base + "/users/fetchShortProfile", {
      method: "POST", headers: { Authorization: `Bearer ${token.profileToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(ids), signal: AbortSignal.timeout(20_000), redirect: "error"
    });
    if (!response.ok) throw new TeamsApiError(response.status);
    const data = await response.json() as { value?: Array<{ mri?: string; displayName?: string; email?: string; userPrincipalName?: string }> };
    return (data.value ?? []).filter((p) => p.mri).map((p) => ({ id: p.mri!, displayName: p.displayName ?? "", email: p.email ?? p.userPrincipalName ?? "" }));
  }

  async fetchMemberIds(conversationId: string, token: TeamsTokenBundle): Promise<string[]> {
    const data = await this.requestJson<{ members?: Array<{ id?: string }> }>(
      `${this.apiBase(token)}/threads/${encodeURIComponent(conversationId)}?view=msnp24Equivalent`, token
    );
    return (data.members ?? []).map((member) => member.id ?? "").filter((id) => /^(?:8|28):/.test(id));
  }

  /**
   * Fetch messages from a conversation.
   */
  async fetchMessages(
    conversationId: string,
    options?: { pageSize?: number; token?: TeamsTokenBundle }
  ): Promise<ChatMessageSummary[]> {
    const token = options?.token ?? this.getToken();
    if (!token) {
      throw new Error("No Teams skypeToken available.");
    }

    const pageSize = options?.pageSize ?? 20;
    const baseUrl = this.apiBase(token);
    const url = `${baseUrl}/users/ME/conversations/${encodeURIComponent(conversationId)}/messages?pageSize=${pageSize}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      method: "GET",
      headers: this.authHeaders(token)
    });

    if (!response.ok) {
      throw new TeamsApiError(response.status);
    }

    const data = (await response.json()) as {
      messages?: Array<{
        id: string;
        conversationId: string;
        content?: string;
        imdisplayname?: string;
        originalarrivaltime?: string;
      }>;
    };

    return (data.messages ?? []).map((m) => ({
      id: m.id,
      conversationId: m.conversationId || conversationId,
      content: m.content || "",
      from: m.imdisplayname,
      timestamp: m.originalarrivaltime || new Date().toISOString()
    }));
  }
}
