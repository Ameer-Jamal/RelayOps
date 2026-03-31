import type {
  EventObservation,
  Logger,
  MessagingAdapter,
  PullRequestAdapter,
  RuleTrigger,
  TriggerEvent,
  UnreadMessageRecord
} from "../types";
import type { PullRequestRecord, StateStore } from "../types";
import { RulesEngine } from "../rules/rulesEngine";

export interface TriggerRunSummary {
  trigger: RuleTrigger;
  eventsSeen: number;
  rulesExecuted: number;
  rulesSkipped: number;
}

interface OrchestratorDependencies {
  state: StateStore;
  rulesEngine: RulesEngine;
  messaging: MessagingAdapter;
  pullRequests: PullRequestAdapter;
  logger: Logger;
}

export class RelayOpsOrchestrator {
  constructor(private readonly dependencies: OrchestratorDependencies) {}

  async runTrigger(trigger: RuleTrigger): Promise<TriggerRunSummary> {
    const events = await this.collectEvents(trigger);
    let rulesExecuted = 0;
    let rulesSkipped = 0;

    for (const event of events) {
      const observation = this.dependencies.state.observeEvent(event);
      const results = await this.dependencies.rulesEngine.executeForEvent(event, observation);
      for (const result of results) {
        if (result.executed) {
          rulesExecuted += 1;
        } else {
          rulesSkipped += 1;
        }
      }
    }

    this.dependencies.logger.info("Trigger run complete", {
      trigger,
      eventsSeen: events.length,
      rulesExecuted,
      rulesSkipped
    });

    return {
      trigger,
      eventsSeen: events.length,
      rulesExecuted,
      rulesSkipped
    };
  }

  private async collectEvents(trigger: RuleTrigger): Promise<TriggerEvent[]> {
    switch (trigger) {
      case "new_pr":
        return this.collectPullRequestEvents();
      case "unread_message":
        return this.collectUnreadMessageEvents();
      case "manual":
        return [
          {
            trigger: "manual",
            id: `manual:${new Date().toISOString()}`,
            occurredAt: new Date().toISOString(),
            payload: {
              requestedAt: new Date().toISOString()
            },
            source: "manual"
          }
        ];
      default:
        return [];
    }
  }

  private async collectPullRequestEvents(): Promise<TriggerEvent<PullRequestRecord>[]> {
    const items = await this.dependencies.pullRequests.readOpenPullRequests();
    return items.map((item) => ({
      trigger: "new_pr",
      id: item.id,
      occurredAt: item.createdAt,
      payload: item,
      source: "pull_request_source"
    }));
  }

  private async collectUnreadMessageEvents(): Promise<TriggerEvent<UnreadMessageRecord>[]> {
    const items = await this.dependencies.messaging.readUnread();
    return items.map((item) => ({
      trigger: "unread_message",
      id: item.id,
      occurredAt: item.timestamp,
      payload: item,
      source: "teams"
    }));
  }
}
