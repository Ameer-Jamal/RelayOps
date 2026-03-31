import type { PullRequestRecord, SummaryAdapter, SummaryResult } from "../../types";

export class PlaceholderSummaryAdapter implements SummaryAdapter {
  async summarize(input: PullRequestRecord): Promise<SummaryResult> {
    const repositoryPart = input.repository ? ` in ${input.repository}` : "";
    const descriptionPart = input.description ? ` ${input.description}` : "";
    return {
      text: `Placeholder summary: ${input.title}${repositoryPart}.${descriptionPart}`.trim()
    };
  }
}
