import type { BitbucketPrSourceConfig, Logger, PullRequestAdapter, PullRequestRecord } from "../../types";

interface BitbucketPage<T> {
  values: T[];
  next?: string | null;
}

interface BbRepo {
  slug: string;
}

interface BbUser {
  display_name: string;
  uuid: string;
  account_id?: string;
}

interface BbPr {
  id: number;
  title: string;
  description?: string;
  author: BbUser;
  created_on: string;
  links: { html: { href: string } };
}

class BitbucketApiError extends Error {
  constructor(readonly status: number) {
    super(status === 401
      ? "Bitbucket authentication failed (HTTP 401). In Setup, use your Atlassian account email and a Bitbucket API token; app passwords are no longer supported."
      : `Bitbucket API failed (HTTP ${status}). Check repository access and token scopes.`);
  }
}

export class BitbucketPullRequestAdapter implements PullRequestAdapter {
  constructor(
    private readonly cfg: BitbucketPrSourceConfig,
    private readonly defaultLimit: number,
    private readonly logger: Logger
  ) {}

  private authorizationHeader(): string {
    const token = Buffer.from(`${this.cfg.username}:${this.cfg.appPassword}`, "utf8").toString("base64");
    return `Basic ${token}`;
  }

  private async fetchPage<T>(url: string): Promise<BitbucketPage<T>> {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "api.bitbucket.org") {
      throw new Error("Refusing to send Bitbucket credentials to an unexpected API host.");
    }
    const response = await fetch(url, {
      signal: AbortSignal.timeout(20_000),
      redirect: "error",
      headers: {
        Authorization: this.authorizationHeader(),
        Accept: "application/json"
      }
    });

    if (!response.ok) {
      throw new BitbucketApiError(response.status);
    }

    return response.json() as Promise<BitbucketPage<T>>;
  }

  async readOpenPullRequests(limit?: number): Promise<PullRequestRecord[]> {
    const cap = limit ?? this.defaultLimit;
    const slugs =
      this.cfg.repositorySlugs.length > 0 ? this.cfg.repositorySlugs : await this.listAllRepositorySlugs();

    const merged: PullRequestRecord[] = [];
    let repositoriesFailed = 0;
    for (const slug of slugs) {
      if (merged.length >= cap) {
        break;
      }
      try {
        const batch = await this.fetchOpenPullRequestsForRepository(slug, cap - merged.length);
        merged.push(...batch);
      } catch (error) {
        if (error instanceof BitbucketApiError && (error.status === 401 || error.status === 403)) throw error;
        repositoriesFailed += 1;
        this.logger.warn("Bitbucket pull request list failed for repository", {
          workspace: this.cfg.workspace,
          slug,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (slugs.length > 0 && repositoriesFailed === slugs.length) {
      throw new Error("Failed to read pull requests from every configured repository. Check the repository slugs, credentials, and execution logs.");
    }
    merged.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const sliced = merged.slice(0, cap);
    this.logger.debug("Bitbucket open pull requests loaded", { count: sliced.length, workspace: this.cfg.workspace });
    return sliced;
  }

  private async listAllRepositorySlugs(): Promise<string[]> {
    const slugs: string[] = [];
    let url: string | null =
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(this.cfg.workspace)}?pagelen=100`;

    while (url) {
      const batch: BitbucketPage<BbRepo> = await this.fetchPage<BbRepo>(url);
      for (const repo of batch.values) {
        slugs.push(repo.slug);
      }
      url = batch.next ?? null;
    }

    return slugs;
  }

  private async fetchOpenPullRequestsForRepository(repoSlug: string, maxCount: number): Promise<PullRequestRecord[]> {
    const out: PullRequestRecord[] = [];
    let url: string | null =
      `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(this.cfg.workspace)}/${encodeURIComponent(
        repoSlug
      )}/pullrequests?state=OPEN&pagelen=50`;

    while (url && out.length < maxCount) {
      const batch: BitbucketPage<BbPr> = await this.fetchPage<BbPr>(url);
      for (const pr of batch.values) {
        if (out.length >= maxCount) {
          break;
        }
        if (this.cfg.authorUuid && !this.authorMatches(pr.author, this.cfg.authorUuid)) {
          continue;
        }
        out.push(this.mapPr(repoSlug, pr));
      }
      url = batch.next ?? null;
    }

    return out;
  }

  private authorMatches(author: BbUser, filterRaw: string): boolean {
    const filter = filterRaw.trim().toLowerCase().replace(/[{}]/g, "");
    if (!filter) {
      return true;
    }

    const uuidNorm = String(author.uuid).toLowerCase().replace(/[{}]/g, "");
    const accountNorm = author.account_id?.toLowerCase().replace(/[{}]/g, "") ?? "";
    const keys = [uuidNorm, accountNorm].filter(Boolean);

    const wantVariants = new Set<string>([filter, filter.replace(/^712020:/, "")]);

    for (const key of keys) {
      for (const want of wantVariants) {
        if (key === want) {
          return true;
        }
      }
    }

    return false;
  }

  private mapPr(repoSlug: string, pr: BbPr): PullRequestRecord {
    const id = `${this.cfg.workspace}/${repoSlug}#${pr.id}`;
    return {
      id,
      title: pr.title,
      author: pr.author.display_name,
      url: pr.links.html.href,
      repository: `${this.cfg.workspace}/${repoSlug}`,
      description: pr.description ?? undefined,
      createdAt: pr.created_on,
      raw: pr as unknown as Record<string, unknown>
    };
  }
}
