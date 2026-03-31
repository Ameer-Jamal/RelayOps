import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AppConfig, Logger } from "../../types";

export class PlaywrightBrowserManager {
  private context?: BrowserContext;
  private contextLaunchPromise?: Promise<BrowserContext>;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  private isContextUsable(context: BrowserContext): boolean {
    const browser = context.browser();
    if (!browser) {
      return true;
    }
    return browser.isConnected();
  }

  private async launchPersistentContext(): Promise<BrowserContext> {
    const context = await chromium.launchPersistentContext(this.config.browser.profileDir, {
      headless: this.config.browser.headless,
      channel: this.config.browser.channel,
      viewport: { width: 1440, height: 1024 }
    });

    context.on("close", () => {
      this.logger.info("Playwright persistent context closed");
      if (this.context === context) {
        this.context = undefined;
      }
    });

    this.context = context;

    this.logger.info("Playwright persistent context initialized", {
      profileDir: this.config.browser.profileDir,
      headless: this.config.browser.headless
    });

    return context;
  }

  async getContext(): Promise<BrowserContext> {
    if (this.context && this.isContextUsable(this.context)) {
      return this.context;
    }

    if (this.context && !this.isContextUsable(this.context)) {
      this.logger.warn("Browser was closed or disconnected; launching a new persistent context");
      this.context = undefined;
    }

    if (!this.contextLaunchPromise) {
      this.contextLaunchPromise = this.launchPersistentContext().finally(() => {
        this.contextLaunchPromise = undefined;
      });
    }

    return this.contextLaunchPromise;
  }

  async getPage(): Promise<Page> {
    const context = await this.getContext();
    const openPage = context.pages().find((page) => !page.isClosed());
    if (openPage) {
      return openPage;
    }

    try {
      return await context.newPage();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("has been closed") || message.includes("Target page, context or browser has been closed")) {
        this.logger.warn("Browser disconnected while opening a page; restarting persistent context", { message });
        this.context = undefined;
        const next = await this.getContext();
        return next.newPage();
      }
      throw error;
    }
  }

  async captureFailureScreenshot(page: Page, label: string): Promise<string | undefined> {
    if (!this.config.browser.captureScreenshots) {
      return undefined;
    }

    const sanitizedLabel = label.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
    const filename = `${Date.now()}-${sanitizedLabel}.png`;
    const destination = path.join(this.config.browser.screenshotsDir, filename);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    await page.screenshot({ path: destination, fullPage: true });
    return destination;
  }

  async close(): Promise<void> {
    if (this.contextLaunchPromise) {
      await this.contextLaunchPromise.catch(() => undefined);
    }
    this.contextLaunchPromise = undefined;

    const context = this.context;
    this.context = undefined;
    if (context) {
      await context.close().catch(() => undefined);
    }
  }
}
