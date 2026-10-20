import type {
  EventObservation,
  Logger,
  MessagingAdapter,
  PullRequestAdapter,
  RuleTrigger,
  TriggerRunOptions,
  TriggerEvent,
  UnreadMessageRecord
} from "../types";
import type { PullRequestRecord, StateStore } from "../types";
import { RulesEngine } from "../rules/rulesEngine";
import type { ActionLock } from "./actionLock";

export interface TriggerRunSummary {
  trigger: RuleTrigger;
  eventsSeen: number;
  rulesExecuted: number;
  rulesSkipped: number;
  rulesFailed: number;
}

interface OrchestratorDependencies {
  state: StateStore;
  rulesEngine: RulesEngine;
  messaging: MessagingAdapter;
  pullRequests: PullRequestAdapter;
  logger: Logger;
  actionLock: ActionLock;
}

export class RelayOpsOrchestrator {
  private pullRequests: PullRequestAdapter;

  constructor(private readonly dependencies: OrchestratorDependencies) {
    this.pullRequests = dependencies.pullRequests;
  }

  setPullRequestAdapter(adapter: PullRequestAdapter): void {
    this.pullRequests = adapter;
  }

  async runTrigger(trigger: RuleTrigger, options?: TriggerRunOptions): Promise<TriggerRunSummary> {
    return this.dependencies.actionLock.runExclusive(`run-trigger:${trigger}`, () =>
      this.runTriggerUnlocked(trigger, options)
    );
  }

  private async runTriggerUnlocked(
    trigger: RuleTrigger,
    options?: TriggerRunOptions
  ): Promise<TriggerRunSummary> {
    const events = await this.collectEvents(trigger);
    let rulesExecuted = 0;
    let rulesSkipped = 0;
    let rulesFailed = 0;

    for (const event of events) {
      try {
        const observation = this.dependencies.state.observeEvent(event);
        const results = await this.dependencies.rulesEngine.executeForEvent(event, observation, options);
        for (const result of results) {
          if (result.executed) {
            rulesExecuted += 1;
          } else if (result.failed) {
            rulesFailed += 1;
          } else {
            rulesSkipped += 1;
          }
        }
      } catch (error) {
        this.dependencies.logger.error("Trigger event handling failed; continuing with remaining events", {
          trigger,
          eventId: event.id,
          error: error instanceof Error ? error.message : String(error)
        });
        rulesFailed += 1;
      }
    }

    this.dependencies.logger.info("Trigger run complete", {
      trigger,
      eventsSeen: events.length,
      rulesExecuted,
      rulesSkipped,
      rulesFailed,
      ignoreGuards: Boolean(options?.ignoreGuards)
    });

    return {
      trigger,
      eventsSeen: events.length,
      rulesExecuted,
      rulesSkipped,
      rulesFailed
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
    const items = await this.pullRequests.readOpenPullRequests();
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
