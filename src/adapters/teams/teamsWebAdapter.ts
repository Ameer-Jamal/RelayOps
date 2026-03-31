import crypto from "node:crypto";
import type { Locator, Page } from "playwright";
import { withRetry } from "../../core/retry";
import type {
  AppConfig,
  Logger,
  MessageRecord,
  MessageTarget,
  MessagingAdapter,
  UnreadMessageRecord
} from "../../types";
import { PlaywrightBrowserManager } from "../browser/playwrightBrowser";
import { type SelectorCandidate, teamsSelectors } from "./selectors";

interface LocatorCandidate {
  description: string;
  resolve: () => Locator;
}

type SessionState = "ready" | "logged_out" | "unknown";

interface SessionObservation {
  state: SessionState;
  url: string;
  title: string;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildId(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class TeamsWebAdapter implements MessagingAdapter {
  constructor(
    private readonly browser: PlaywrightBrowserManager,
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async validateSession(options?: { reason?: string; waitForLogin?: boolean }): Promise<void> {
    const page = await this.browser.getPage();
    const reason = options?.reason ?? "operation";
    await this.safeGoto(page, this.config.teams.baseUrl, { label: `teams-home:${reason}` });

    const observation = await this.waitForKnownSessionState(page, reason);
    if (observation.state === "ready") {
      this.logger.info("Teams session validated", { reason });
      return;
    }

    if (observation.state === "logged_out") {
      const shouldWait = options?.waitForLogin ?? false;
      this.logger.warn("Teams session is not authenticated", {
        reason,
        waitForLogin: shouldWait,
        profileDir: this.config.browser.profileDir,
        url: observation.url,
        title: observation.title
      });

      if (shouldWait) {
        await this.waitForLogin(page, reason);
        return;
      }

      await this.captureFailure(`teams-session-invalid-${reason}`);
      throw new Error(
        `Teams Web session is not authenticated for ${reason}. Sign in using the persistent profile at ${this.config.browser.profileDir} or enable wait-for-login mode.`
      );
    }

    await this.captureFailure(`teams-session-unknown-${reason}`);
    throw new Error(
      `Teams session state is unknown for ${reason}. Current URL: ${observation.url || "unknown"}, title: ${observation.title || "unknown"}.`
    );
  }

  async inspectSession(): Promise<SessionState> {
    const page = await this.browser.getPage();
    await this.safeGoto(page, this.config.teams.baseUrl, { label: "teams-session-inspect" });
    const observation = await this.waitForKnownSessionState(page, "inspect");
    return observation.state;
  }

  async openSession(): Promise<void> {
    const page = await this.browser.getPage();
    await this.safeGoto(page, this.config.teams.baseUrl, { label: "teams-open-session" });
  }

  async postMessage(target: MessageTarget, text: string): Promise<void> {
    const page = await this.browser.getPage();
    await this.validateSession({ reason: "post_message", waitForLogin: false });
    this.assertTargetIsConfigured(target);
    await this.navigateToTarget(page, target);

    const composerCandidates = this.selectorCandidates(page, teamsSelectors.composer);
    await this.safeType(composerCandidates, text, {
      label: `teams-composer:${target.label ?? target.url ?? "unknown"}`,
      clearExisting: true
    });

    const sendButtonCandidates = this.selectorCandidates(page, teamsSelectors.sendButton);
    await this.safeClick(sendButtonCandidates, {
      label: `teams-send:${target.label ?? target.url ?? "unknown"}`
    });

    this.logger.info("Teams message posted", { target: target.label ?? target.url });
  }

  async readMessages(target: MessageTarget, limit = 10): Promise<MessageRecord[]> {
    const page = await this.browser.getPage();
    await this.validateSession({ reason: "read_messages", waitForLogin: false });
    this.assertTargetIsConfigured(target);
    await this.navigateToTarget(page, target);

    const items = await this.safeLocateAll(this.selectorCandidates(page, teamsSelectors.messageItems), {
      label: `teams-message-items:${target.label ?? target.url ?? "unknown"}`
    });
    const selected = items.slice(Math.max(0, items.length - limit));

    const results: MessageRecord[] = [];
    for (const [index, item] of selected.entries()) {
      const text = await this.safeReadText(item, {
        label: `teams-message-text:${target.label ?? target.url ?? "unknown"}:${index}`
      });
      if (!text) {
        continue;
      }

      results.push({
        id: buildId(`${target.label ?? target.url ?? "teams"}:${text}:${index}`),
        target,
        text,
        timestamp: new Date().toISOString(),
        raw: {
          index
        }
      });
    }

    return results;
  }

  async readUnread(): Promise<UnreadMessageRecord[]> {
    const page = await this.browser.getPage();
    await this.validateSession({ reason: "read_unread", waitForLogin: false });

    const results = new Map<string, UnreadMessageRecord>();
    const indicators = await this.safeLocateAll(this.selectorCandidates(page, teamsSelectors.unreadIndicators), {
      label: "teams-unread-indicators",
      allowEmpty: true
    });

    for (const [index, badge] of indicators.entries()) {
      const item = await this.closestNavigationItem(badge);
      const label =
        (await this.safeReadAttribute(item, "aria-label", {
          label: `teams-unread-aria-label:${index}`,
          allowEmpty: true
        })) ||
        (await this.safeReadText(item, {
          label: `teams-unread-text:${index}`,
          allowEmpty: true
        }));

      const normalizedLabel = label.replace(/\s+/g, " ").trim();
      if (!normalizedLabel) {
        continue;
      }

      const href = await this.safeReadAttribute(item, "href", {
        label: `teams-unread-href:${index}`,
        allowEmpty: true
      });
      const id = buildId(`${normalizedLabel}:${href}`);
      results.set(id, {
        id,
        label: normalizedLabel,
        target: {
          label: normalizedLabel,
          url: href || undefined
        },
        url: href || undefined,
        timestamp: new Date().toISOString()
      });
    }

    return [...results.values()];
  }

  private async waitForLogin(page: Page, reason: string): Promise<void> {
    const deadline = Date.now() + this.config.teams.loginTimeoutMs;
    while (Date.now() < deadline) {
      const observation = await this.observeSessionState(page);
      if (observation.state === "ready") {
        this.logger.info("Teams session became ready", { reason });
        return;
      }

      await sleep(this.config.teams.loginPollIntervalMs);
    }

    await this.captureFailure(`teams-login-timeout-${reason}`);
    throw new Error(
      `Timed out waiting for Teams login during ${reason}. Timeout: ${this.config.teams.loginTimeoutMs}ms.`
    );
  }

  private async waitForKnownSessionState(page: Page, reason: string): Promise<SessionObservation> {
    const timeoutMs = Math.min(this.config.teams.navigationTimeoutMs, 15000);
    const deadline = Date.now() + timeoutMs;
    let observation = await this.observeSessionState(page);

    while (Date.now() < deadline && observation.state === "unknown") {
      await sleep(750);
      observation = await this.observeSessionState(page);
    }

    if (observation.state === "unknown") {
      this.logger.warn("Teams session state remained unknown after validation polling", {
        reason,
        timeoutMs,
        url: observation.url,
        title: observation.title
      });
    }

    return observation;
  }

  private async observeSessionState(page: Page): Promise<SessionObservation> {
    const url = page.url();
    const title = await page.title().catch(() => "");

    if (this.looksLikeLoggedOutUrl(url) || this.looksLikeLoggedOutTitle(title)) {
      return { state: "logged_out", url, title };
    }

    const ready = await this.anyVisible(this.selectorCandidates(page, teamsSelectors.shellReady), {
      label: "teams-shell-ready"
    });
    if (ready) {
      return { state: "ready", url, title };
    }

    const composerVisible = await this.anyVisible(this.selectorCandidates(page, teamsSelectors.composer), {
      label: "teams-shell-composer"
    });
    if (composerVisible) {
      return { state: "ready", url, title };
    }

    const messageItemsVisible = await this.anyVisible(
      this.selectorCandidates(page, teamsSelectors.messageItems),
      {
        label: "teams-shell-message-items"
      }
    );
    if (messageItemsVisible) {
      return { state: "ready", url, title };
    }

    const loggedOut = await this.anyVisible(this.selectorCandidates(page, teamsSelectors.loginHints), {
      label: "teams-login-hints"
    });
    if (loggedOut) {
      return { state: "logged_out", url, title };
    }

    return { state: "unknown", url, title };
  }

  private async navigateToTarget(page: Page, target: MessageTarget): Promise<void> {
    await this.ensureTargetWorkspace(page, target);

    if (target.label) {
      await this.navigateToLabel(page, target.label);

      const targetReady = await this.waitForTargetView(page, target, `teams-target-label:${target.label}`);
      if (targetReady) {
        this.logger.info("Teams target resolved via label", {
          target: target.label,
          currentUrl: page.url()
        });
        return;
      }

      this.logger.warn("Teams target label did not resolve to a ready view", {
        targetLabel: target.label,
        targetUrl: target.url,
        currentUrl: page.url(),
        currentTitle: await page.title().catch(() => "")
      });
    }

    if (target.url) {
      await this.safeGoto(page, target.url, {
        label: `teams-target-url:${target.label ?? target.url}`
      });

      if (await this.waitForTargetView(page, target, `teams-target-url:${target.label ?? target.url}`)) {
        this.logger.info("Teams target resolved via URL fallback", {
          target: target.label ?? target.url,
          url: page.url()
        });
        return;
      }

      this.logger.warn("Teams target URL fallback did not open a ready view", {
        target: target.label ?? target.url,
        targetUrl: target.url,
        currentUrl: page.url(),
        currentTitle: await page.title().catch(() => "")
      });
    }

    if (!target.label) {
      await this.captureFailure("teams-target-navigation-missing-label");
      throw new Error("Teams target requires a label when the URL does not resolve into a ready Teams view.");
    }

    await this.captureFailure(`teams-target-unresolved:${target.label}`);
    throw new Error(`Teams target "${target.label}" did not resolve to a ready chat or channel view.`);
  }

  private async navigateToLabel(page: Page, label: string): Promise<void> {
    const exactLabel = new RegExp(`^${escapeRegex(label)}$`, "i");
    const partialLabel = new RegExp(escapeRegex(label), "i");

    const directTargetCandidates: LocatorCandidate[] = [
      {
        description: "list item containing target text",
        resolve: () =>
          page
            .locator('[role="listitem"], [role="treeitem"], a, button, [data-tid]')
            .filter({ hasText: partialLabel })
            .first()
      },
      {
        description: "link by exact accessible name",
        resolve: () => page.getByRole("link", { name: exactLabel }).first()
      },
      {
        description: "button by exact accessible name",
        resolve: () => page.getByRole("button", { name: exactLabel }).first()
      },
      {
        description: "treeitem by partial accessible name",
        resolve: () => page.getByRole("treeitem", { name: partialLabel }).first()
      }
    ];

    if (await this.anyVisible(directTargetCandidates, { label: `teams-target-direct:${label}` })) {
      await this.safeClick(directTargetCandidates, {
        label: `teams-target-direct:${label}`
      });
      return;
    }

    const sectionScopedCandidates = this.buildSectionScopedTargetCandidates(page, partialLabel);
    if (await this.anyVisible(sectionScopedCandidates, { label: `teams-target-section:${label}` })) {
      await this.safeClick(sectionScopedCandidates, {
        label: `teams-target-section:${label}`
      });
      return;
    }

    const searchCandidates = this.selectorCandidates(page, teamsSelectors.searchInput);
    await this.safeType(searchCandidates, label, {
      label: `teams-target-search:${label}`,
      clearExisting: true
    });

    const searchResultCandidates: LocatorCandidate[] = [
      {
        description: "search option by partial accessible name",
        resolve: () => page.getByRole("option", { name: partialLabel }).first()
      },
      {
        description: "search link by partial accessible name",
        resolve: () => page.getByRole("link", { name: partialLabel }).first()
      },
      {
        description: "search button by partial accessible name",
        resolve: () => page.getByRole("button", { name: partialLabel }).first()
      }
    ];

    await this.safeClick(searchResultCandidates, {
      label: `teams-target-search-result:${label}`
    });
  }

  private buildSectionScopedTargetCandidates(page: Page, partialLabel: RegExp): LocatorCandidate[] {
    return [
      {
        description: "chat or channel list item by text within main navigation pane",
        resolve: () =>
          page
            .locator('nav, aside, [role="navigation"], [data-tid="app-layout-area--left-nav"]')
            .locator('[role="listitem"], [role="treeitem"], a, button, [data-tid]')
            .filter({ hasText: partialLabel })
            .first()
      },
      {
        description: "left rail region text match",
        resolve: () =>
          page
            .locator('[data-tid="app-layout-area--left-nav"], aside')
            .locator(':scope *')
            .filter({ hasText: partialLabel })
            .first()
      }
    ];
  }

  private async ensureTargetWorkspace(page: Page, target: MessageTarget): Promise<void> {
    if (target.kind === "chat") {
      await this.openWorkspace(page, "Chat", "teams-workspace-chat");
      return;
    }

    if (target.kind === "channel") {
      await this.openWorkspace(page, "Teams", "teams-workspace-teams");
    }
  }

  private async openWorkspace(page: Page, workspaceName: string, label: string): Promise<void> {
    const exactName = new RegExp(`^${escapeRegex(workspaceName)}$`, "i");
    const candidates: LocatorCandidate[] = [
      {
        description: `${workspaceName} nav by button role`,
        resolve: () => page.getByRole("button", { name: exactName }).first()
      },
      {
        description: `${workspaceName} nav by link role`,
        resolve: () => page.getByRole("link", { name: exactName }).first()
      },
      {
        description: `${workspaceName} nav by text`,
        resolve: () =>
          page
            .locator('[role="navigation"], [data-tid="app-layout-area--left-nav"], aside')
            .locator(':scope *')
            .filter({ hasText: exactName })
            .first()
      }
    ];

    if (await this.anyVisible(candidates, { label })) {
      await this.safeClick(candidates, { label });
    }
  }

  private async waitForTargetView(page: Page, target: MessageTarget, label: string): Promise<boolean> {
    const deadline = Date.now() + Math.min(this.config.teams.navigationTimeoutMs, 12000);

    while (Date.now() < deadline) {
      const readyCandidates: LocatorCandidate[] = [
        ...this.selectorCandidates(page, teamsSelectors.composer),
        ...this.selectorCandidates(page, teamsSelectors.messageItems)
      ];

      if (target.label) {
        const partialLabel = new RegExp(escapeRegex(target.label), "i");
        readyCandidates.push(
          {
            description: "target heading by accessible name",
            resolve: () => page.getByRole("heading", { name: partialLabel }).first()
          },
          {
            description: "target visible text",
            resolve: () => page.getByText(partialLabel).first()
          }
        );
      } else {
        readyCandidates.push(...this.selectorCandidates(page, teamsSelectors.targetHeaders));
      }

      if (await this.anyVisible(readyCandidates, { label: `${label}-ready` })) {
        return true;
      }

      await sleep(750);
    }

    this.logger.warn("Teams target view did not become ready", {
      label,
      targetLabel: target.label,
      targetUrl: target.url,
      currentUrl: page.url(),
      currentTitle: await page.title().catch(() => "")
    });
    return false;
  }

  private selectorCandidates(page: Page, selectors: readonly SelectorCandidate[]): LocatorCandidate[] {
    return selectors.map((candidate) => ({
      description: candidate.description,
      resolve: () => page.locator(candidate.selector).first()
    }));
  }

  private async safeGoto(
    page: Page,
    url: string,
    options: { label: string; retries?: number }
  ): Promise<void> {
    const normalizedUrl = this.normalizeTeamsUrl(url);
    await withRetry(
      async () => {
        this.logger.debug("Teams navigation attempt", {
          label: options.label,
          url,
          ...(normalizedUrl !== url ? { normalizedUrl } : {})
        });
        await page.goto(normalizedUrl, {
          waitUntil: "domcontentloaded",
          timeout: this.config.teams.navigationTimeoutMs
        });
        await this.ensureWebAppInsteadOfLauncher(page, options.label);
      },
      options.retries ?? this.config.teams.actionRetries,
      async (attempt, error) => {
        this.logger.warn("Teams navigation retry", {
          label: options.label,
          url,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.captureFailure(`${options.label}-goto`);
      }
    );
  }

  private async ensureWebAppInsteadOfLauncher(page: Page, label: string): Promise<void> {
    const currentUrl = page.url();
    const launcherButtonCandidates = this.selectorCandidates(page, teamsSelectors.launcherUseWebApp);
    const launcherVisible = await this.anyVisible(launcherButtonCandidates, {
      label: `${label}-launcher-use-web-app`
    });

    if (!launcherVisible && !this.isLauncherUrl(currentUrl)) {
      return;
    }

    this.logger.info("Teams launcher flow detected; keeping automation in the web app", {
      label,
      currentUrl
    });

    if (launcherVisible) {
      await this.safeClick(launcherButtonCandidates, {
        label: `${label}-launcher-use-web-app`
      });
      await page.waitForLoadState("domcontentloaded", {
        timeout: this.config.teams.navigationTimeoutMs
      });
      return;
    }

    const normalizedCurrentUrl = this.normalizeTeamsUrl(currentUrl);
    if (normalizedCurrentUrl !== currentUrl) {
      await page.goto(normalizedCurrentUrl, {
        waitUntil: "domcontentloaded",
        timeout: this.config.teams.navigationTimeoutMs
      });
    }
  }

  private async safeClick(
    candidates: LocatorCandidate[],
    options: { label: string; retries?: number }
  ): Promise<void> {
    await withRetry(
      async () => {
        const { locator, description } = await this.resolveFirstInteractable(candidates, options.label);
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ trial: true, timeout: this.config.teams.selectorTimeoutMs });
        await locator.click({ timeout: this.config.teams.selectorTimeoutMs });
        this.logger.debug("Teams click succeeded", {
          label: options.label,
          selector: description
        });
      },
      options.retries ?? this.config.teams.actionRetries,
      async (attempt, error) => {
        this.logger.warn("Teams click retry", {
          label: options.label,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.captureFailure(`${options.label}-click`);
      }
    );
  }

  private async safeType(
    candidates: LocatorCandidate[],
    text: string,
    options: { label: string; retries?: number; clearExisting?: boolean }
  ): Promise<void> {
    await withRetry(
      async () => {
        const page = await this.browser.getPage();
        const { locator, description } = await this.resolveFirstInteractable(candidates, options.label);
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ trial: true, timeout: this.config.teams.selectorTimeoutMs });
        await locator.click({ timeout: this.config.teams.selectorTimeoutMs });

        const tagName = await locator.evaluate((element) => element.tagName.toLowerCase());
        if (tagName === "input" || tagName === "textarea") {
          if (options.clearExisting) {
            await locator.fill("", { timeout: this.config.teams.selectorTimeoutMs });
          }
          await locator.fill(text, { timeout: this.config.teams.selectorTimeoutMs });
        } else {
          if (options.clearExisting) {
            await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
            await page.keyboard.press("Backspace");
          }
          await page.keyboard.insertText(text);
        }

        this.logger.debug("Teams type succeeded", {
          label: options.label,
          selector: description,
          textLength: text.length
        });
      },
      options.retries ?? this.config.teams.actionRetries,
      async (attempt, error) => {
        this.logger.warn("Teams type retry", {
          label: options.label,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.captureFailure(`${options.label}-type`);
      }
    );
  }

  private async safeReadText(
    locator: Locator,
    options: { label: string; retries?: number; allowEmpty?: boolean }
  ): Promise<string> {
    return withRetry(
      async () => {
        await locator.waitFor({ state: "visible", timeout: this.config.teams.selectorTimeoutMs });
        const value = (await locator.innerText()).trim();
        if (!value && !options.allowEmpty) {
          throw new Error(`Empty text for ${options.label}`);
        }
        return value;
      },
      options.retries ?? this.config.teams.actionRetries,
      async (attempt, error) => {
        this.logger.warn("Teams text read retry", {
          label: options.label,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.captureFailure(`${options.label}-text`);
      }
    );
  }

  private async safeReadAttribute(
    locator: Locator,
    attribute: string,
    options: { label: string; retries?: number; allowEmpty?: boolean }
  ): Promise<string> {
    return withRetry(
      async () => {
        await locator.waitFor({ state: "attached", timeout: this.config.teams.selectorTimeoutMs });
        const value = (await locator.getAttribute(attribute))?.trim() ?? "";
        if (!value && !options.allowEmpty) {
          throw new Error(`Missing attribute ${attribute} for ${options.label}`);
        }
        return value;
      },
      options.retries ?? this.config.teams.actionRetries,
      async (attempt, error) => {
        this.logger.warn("Teams attribute read retry", {
          label: options.label,
          attribute,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.captureFailure(`${options.label}-attribute`);
      }
    );
  }

  private async safeLocateAll(
    candidates: LocatorCandidate[],
    options: { label: string; retries?: number; allowEmpty?: boolean }
  ): Promise<Locator[]> {
    return withRetry(
      async () => {
        for (const candidate of candidates) {
          const locator = candidate.resolve();
          const count = await locator.count().catch(() => 0);
          if (count > 0) {
            this.logger.debug("Teams selector chain resolved", {
              label: options.label,
              selector: candidate.description,
              count
            });
            return locator.all();
          }

          this.logger.debug("Teams selector candidate returned no matches", {
            label: options.label,
            selector: candidate.description
          });
        }

        if (options.allowEmpty) {
          return [];
        }

        throw new Error(`No locators matched for ${options.label}`);
      },
      options.retries ?? this.config.teams.actionRetries,
      async (attempt, error) => {
        this.logger.warn("Teams locate-all retry", {
          label: options.label,
          attempt,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.captureFailure(`${options.label}-locate-all`);
      }
    );
  }

  private async resolveFirstInteractable(
    candidates: LocatorCandidate[],
    label: string
  ): Promise<{ locator: Locator; description: string }> {
    for (const candidate of candidates) {
      const locator = candidate.resolve();
      const visible = await locator
        .isVisible({ timeout: this.config.teams.selectorTimeoutMs })
        .catch(() => false);

      if (!visible) {
        this.logger.debug("Teams selector candidate not visible", {
          label,
          selector: candidate.description
        });
        continue;
      }

      try {
        await locator.scrollIntoViewIfNeeded();
        await locator.click({ trial: true, timeout: this.config.teams.selectorTimeoutMs });
        return {
          locator,
          description: candidate.description
        };
      } catch (error) {
        this.logger.warn("Teams selector candidate visible but not interactable", {
          label,
          selector: candidate.description,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    await this.captureFailure(`${label}-selector-chain`);
    throw new Error(`No interactable selector matched for ${label}`);
  }

  private async anyVisible(candidates: LocatorCandidate[], options: { label: string }): Promise<boolean> {
    for (const candidate of candidates) {
      const visible = await candidate
        .resolve()
        .isVisible({ timeout: this.config.teams.selectorTimeoutMs })
        .catch(() => false);
      if (visible) {
        this.logger.debug("Teams selector candidate visible", {
          label: options.label,
          selector: candidate.description
        });
        return true;
      }

      this.logger.debug("Teams selector candidate not visible", {
        label: options.label,
        selector: candidate.description
      });
    }

    return false;
  }

  private async closestNavigationItem(locator: Locator): Promise<Locator> {
    return locator.locator(
      "xpath=ancestor-or-self::*[@role='treeitem' or @role='listitem' or self::a or self::button][1]"
    );
  }

  private async captureFailure(label: string): Promise<void> {
    try {
      const page = await this.browser.getPage();
      const screenshotPath = await this.browser.captureFailureScreenshot(page, label);
      if (screenshotPath) {
        this.logger.warn("Captured Teams failure screenshot", {
          screenshotPath,
          label,
          currentUrl: page.url(),
          currentTitle: await page.title().catch(() => "")
        });
      }
    } catch (error) {
      this.logger.warn("Failed to capture Teams screenshot", {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private looksLikeLoggedOutUrl(url: string): boolean {
    const normalized = url.toLowerCase();
    return (
      normalized.includes("login.microsoftonline.com") ||
      normalized.includes("login.live.com") ||
      normalized.includes("login.office.com") ||
      normalized.includes("oauth") ||
      normalized.includes("signin")
    );
  }

  private looksLikeLoggedOutTitle(title: string): boolean {
    return /sign in|pick an account|enter password|stay signed in/i.test(title);
  }

  private assertTargetIsConfigured(target: MessageTarget): void {
    const label = target.label?.trim() ?? "";
    const url = target.url?.trim() ?? "";
    if (/^example\b/i.test(label) || /example-placeholder/i.test(url)) {
      throw new Error(
        `Target "${target.name ?? label}" still uses the public example placeholder. Replace it with a real Teams label in your local rules file before sending messages.`
      );
    }
  }

  private isLauncherUrl(url: string): boolean {
    return url.toLowerCase().includes("/dl/launcher/launcher.html");
  }

  private normalizeTeamsUrl(rawUrl: string): string {
    try {
      const parsed = new URL(rawUrl);
      if (!this.isLauncherUrl(parsed.toString())) {
        return rawUrl;
      }

      const nestedUrl = parsed.searchParams.get("url");
      if (!nestedUrl) {
        return rawUrl;
      }

      const decoded = this.decodeRepeatedly(nestedUrl);
      if (decoded.startsWith("http://") || decoded.startsWith("https://")) {
        return decoded;
      }

      if (decoded.startsWith("/")) {
        return `${parsed.origin}${decoded}`;
      }

      return rawUrl;
    } catch {
      return rawUrl;
    }
  }

  private decodeRepeatedly(value: string): string {
    let current = value;
    for (let index = 0; index < 3; index += 1) {
      try {
        const decoded = decodeURIComponent(current);
        if (decoded === current) {
          return current;
        }
        current = decoded;
      } catch {
        return current;
      }
    }

    return current;
  }
}
