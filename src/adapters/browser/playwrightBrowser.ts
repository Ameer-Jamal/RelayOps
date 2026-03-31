import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { AppConfig, Logger } from "../../types";

export class PlaywrightBrowserManager {
  private context?: BrowserContext;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger
  ) {}

  async getContext(): Promise<BrowserContext> {
    if (this.context) {
      return this.context;
    }

    this.context = await chromium.launchPersistentContext(this.config.browser.profileDir, {
      headless: this.config.browser.headless,
      channel: this.config.browser.channel,
      viewport: { width: 1440, height: 1024 }
    });

    this.logger.info("Playwright persistent context initialized", {
      profileDir: this.config.browser.profileDir,
      headless: this.config.browser.headless
    });

    return this.context;
  }

  async getPage(): Promise<Page> {
    const context = await this.getContext();
    const existingPage = context.pages()[0];

    if (existingPage) {
      return existingPage;
    }

    return context.newPage();
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
    if (!this.context) {
      return;
    }

    await this.context.close();
    this.context = undefined;
  }
}
