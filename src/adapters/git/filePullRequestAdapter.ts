import fs from "node:fs";
import type { Logger, PullRequestAdapter, PullRequestRecord } from "../../types";

function coercePullRequestRecord(input: Record<string, unknown>): PullRequestRecord {
  return {
    id: String(input.id),
    title: String(input.title),
    author: String(input.author),
    url: String(input.url),
    repository: input.repository ? String(input.repository) : undefined,
    description: input.description ? String(input.description) : undefined,
    createdAt: String(input.createdAt),
    raw: input
  };
}

export class FilePullRequestAdapter implements PullRequestAdapter {
  constructor(
    private readonly sourcePath?: string,
    private readonly sourceUrl?: string,
    private readonly logger?: Logger
  ) {}

  async readOpenPullRequests(limit = 25): Promise<PullRequestRecord[]> {
    const raw = this.sourceUrl ? await this.readFromUrl() : await this.readFromFile();
    const parsed = JSON.parse(raw) as Array<Record<string, unknown>>;
    const items = parsed.slice(0, limit).map(coercePullRequestRecord);
    this.logger?.debug("Loaded pull request records", { count: items.length });
    return items;
  }

  private async readFromFile(): Promise<string> {
    if (!this.sourcePath) {
      return "[]";
    }

    if (!fs.existsSync(this.sourcePath)) {
      this.logger?.warn("Pull request source file not found", {
        sourcePath: this.sourcePath
      });
      return "[]";
    }

    return fs.promises.readFile(this.sourcePath, "utf8");
  }

  private async readFromUrl(): Promise<string> {
    if (!this.sourceUrl) {
      return "[]";
    }

    const response = await fetch(this.sourceUrl);
    if (!response.ok) {
      throw new Error(`Pull request source request failed with status ${response.status}.`);
    }

    return response.text();
  }
}
