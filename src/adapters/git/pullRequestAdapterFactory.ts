import { BitbucketPullRequestAdapter } from "../bitbucket/bitbucketPullRequestAdapter";
import type { AppConfig, Logger, PullRequestAdapter } from "../../types";
import { FilePullRequestAdapter } from "./filePullRequestAdapter";

export function createPullRequestAdapter(config: AppConfig, logger: Logger): PullRequestAdapter {
  const bb = config.bitbucket;
  if (bb?.workspace && bb.username && bb.appPassword) {
    logger.info("Pull request source: Bitbucket Cloud API", {
      workspace: bb.workspace,
      repositories: bb.repositorySlugs.length > 0 ? bb.repositorySlugs : "(all in workspace)",
      authorFilter: bb.authorUuid ? "on" : "off"
    });
    return new BitbucketPullRequestAdapter(bb, config.prSource.limit, logger);
  }

  return new FilePullRequestAdapter(config.prSource.path, config.prSource.url, logger);
}
