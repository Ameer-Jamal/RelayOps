import { renderTemplate } from "../core/template";
import type {
  ActionExecutionContext,
  AlertPayload,
  EventObservation,
  MessageTarget,
  PullRequestRecord,
  RuleAction,
  RuleCondition,
  RuleConfig,
  RulesFileConfig,
  SummaryResult,
  TriggerEvent
} from "../types";
import type { AppConfig, Logger, StateStore } from "../types";

interface RulesEngineDependencies {
  config: AppConfig;
  rules: RulesFileConfig;
  state: StateStore;
  logger: Logger;
  adapters: ActionExecutionContext["adapters"];
}

export interface RuleExecutionResult {
  ruleId: string;
  executed: boolean;
  reason: string;
  executionKey: string;
}

export class RulesEngine {
  constructor(private readonly dependencies: RulesEngineDependencies) {}

  async executeForEvent(event: TriggerEvent, observation: EventObservation): Promise<RuleExecutionResult[]> {
    const matchingRules = this.dependencies.rules.rules.filter(
      (rule) => rule.enabled !== false && rule.trigger === event.trigger
    );

    const results: RuleExecutionResult[] = [];
    for (const rule of matchingRules) {
      const result = await this.evaluateRule(rule, event, observation);
      results.push(result);
    }

    return results;
  }

  private async evaluateRule(
    rule: RuleConfig,
    event: TriggerEvent,
    observation: EventObservation
  ): Promise<RuleExecutionResult> {
    const startedAt = new Date().toISOString();
    const executionKey = this.resolveExecutionKey(rule, event, observation);
    const actionCount = this.normalizeActions(rule).length;
    const decisionContext = {
      ruleId: rule.id,
      trigger: event.trigger,
      eventId: event.id,
      executionKey
    };

    const cooldownKey = `rule:${rule.id}:${executionKey}`;
    if (rule.cooldownMinutes && this.dependencies.state.isCooldownActive(cooldownKey)) {
      return this.recordDecision(
        {
          rule,
          event,
          executionKey,
          actionCount,
          startedAt,
          status: "skipped",
          reason: `Rule cooldown active for ${rule.cooldownMinutes} minute(s)`
        },
        decisionContext
      );
    }

    const conditions = this.normalizeConditions(rule);
    for (const condition of conditions) {
      const passed = this.evaluateCondition(rule, condition, event, observation);
      const reason = passed
        ? `Condition ${condition.type} passed`
        : `Condition ${condition.type} did not pass`;
      this.dependencies.logger.info("Rule condition evaluated", {
        ...decisionContext,
        condition: condition.type,
        passed,
        reason
      });

      if (!passed) {
        return this.recordDecision(
          {
            rule,
            event,
            executionKey,
            actionCount,
            startedAt,
            status: "skipped",
            reason
          },
          decisionContext
        );
      }
    }

    const claimed = this.dependencies.state.beginExecution(rule.id, executionKey, event);
    if (!claimed) {
      return this.recordDecision(
        {
          rule,
          event,
          executionKey,
          actionCount,
          startedAt,
          status: "skipped",
          reason: "Execution key already claimed or completed"
        },
        decisionContext
      );
    }

    try {
      const context = await this.buildContext(rule, event, observation, executionKey);
      const actions = this.normalizeActions(rule);
      for (const action of actions) {
        await this.executeAction(action, context);
      }

      this.dependencies.state.completeExecution(executionKey);
      this.dependencies.state.markProcessed(rule.id, event);

      if (rule.cooldownMinutes) {
        this.dependencies.state.setCooldown(cooldownKey, rule.cooldownMinutes);
      }

      for (const condition of conditions) {
        if (condition.type === "cooldown_elapsed" && condition.key && condition.minutes) {
          const conditionKey = renderTemplate(condition.key, this.buildTemplateContext(event, observation));
          this.dependencies.state.setCooldown(conditionKey, condition.minutes);
        }
      }

      return this.recordDecision(
        {
          rule,
          event,
          executionKey,
          actionCount,
          startedAt,
          status: "executed",
          reason: "All conditions passed and actions completed successfully"
        },
        decisionContext
      );
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.dependencies.state.failExecution(executionKey, reason);
      this.recordHistory({
        rule,
        event,
        executionKey,
        actionCount,
        startedAt,
        status: "failed",
        reason
      });
      this.dependencies.logger.error("Rule execution failed", {
        ...decisionContext,
        reason
      });
      throw error;
    }
  }

  private normalizeConditions(rule: RuleConfig): RuleCondition[] {
    return [...(rule.condition ? [rule.condition] : []), ...(rule.conditions ?? [])];
  }

  private normalizeActions(rule: RuleConfig): RuleAction[] {
    return [...(rule.action ? [rule.action] : []), ...(rule.actions ?? [])];
  }

  private evaluateCondition(
    rule: RuleConfig,
    condition: RuleCondition,
    event: TriggerEvent,
    observation: EventObservation
  ): boolean {
    switch (condition.type) {
      case "always":
        return true;
      case "not_processed":
        return !this.dependencies.state.hasProcessed(rule.id, event.id);
      case "older_than_minutes": {
        const minutes = condition.minutes ?? 0;
        const ageMs = Date.now() - new Date(observation.firstSeenAt).getTime();
        return ageMs >= minutes * 60_000;
      }
      case "cooldown_elapsed": {
        if (!condition.key) {
          return true;
        }

        const context = this.buildTemplateContext(event, observation);
        const key = renderTemplate(condition.key, context);
        return !this.dependencies.state.isCooldownActive(key);
      }
      default:
        return false;
    }
  }

  private async buildContext(
    rule: RuleConfig,
    event: TriggerEvent,
    observation: EventObservation,
    executionKey: string
  ): Promise<ActionExecutionContext> {
    return {
      config: this.dependencies.config,
      rules: this.dependencies.rules,
      rule,
      event,
      observation,
      state: this.dependencies.state,
      adapters: this.dependencies.adapters,
      logger: this.dependencies.logger,
      executionKey
    };
  }

  private buildTemplateContext(
    event: TriggerEvent,
    observation: EventObservation,
    summary?: SummaryResult
  ): Record<string, unknown> {
    return {
      app: {
        name: this.dependencies.config.appName,
        now: new Date().toISOString()
      },
      event: event.payload,
      pr: event.trigger === "new_pr" ? event.payload : undefined,
      message: event.trigger === "unread_message" ? event.payload : undefined,
      summary,
      observation: {
        firstSeenAt: observation.firstSeenAt,
        lastSeenAt: observation.lastSeenAt
      }
    };
  }

  private async executeAction(action: RuleAction, context: ActionExecutionContext): Promise<void> {
    let summary: SummaryResult | undefined;
    const getSummary = async (): Promise<SummaryResult | undefined> => {
      if (summary) {
        return summary;
      }

      if (context.event.trigger !== "new_pr") {
        return undefined;
      }

      summary = await context.adapters.summaries.summarize(context.event.payload as PullRequestRecord);
      return summary;
    };

    switch (action.type) {
      case "post_message": {
        const resolvedTarget = this.resolveTarget(action.target);
        const summaryResult = await getSummary();
        const templateContext = this.buildTemplateContext(context.event, context.observation, summaryResult);
        const text = renderTemplate(action.template ?? action.message ?? "", templateContext).trim();
        if (!text) {
          throw new Error(`Rule ${context.rule.id} produced an empty message body.`);
        }

        await context.adapters.messaging.postMessage(resolvedTarget, text);
        context.logger.info("Rule posted message", {
          ruleId: context.rule.id,
          target: action.target
        });
        return;
      }
      case "alert": {
        const templateContext = this.buildTemplateContext(context.event, context.observation, await getSummary());
        const alert: AlertPayload = {
          dedupeKey: context.executionKey,
          severity: action.severity ?? "info",
          title: action.title ? renderTemplate(action.title, templateContext) : undefined,
          message: renderTemplate(action.message ?? action.template ?? "", templateContext)
        };

        const shouldDispatch = context.state.recordAlert(alert);
        if (shouldDispatch) {
          await context.adapters.alerts.trigger(alert);
        } else {
          context.logger.info("Alert suppressed by state guardrail", {
            ruleId: context.rule.id,
            dedupeKey: alert.dedupeKey
          });
        }
        return;
      }
      case "clear_alerts": {
        const cleared = context.state.clearAlerts();
        await context.adapters.alerts.clearAll();
        context.logger.info("Rule cleared alerts", {
          ruleId: context.rule.id,
          cleared
        });
        return;
      }
      default:
        throw new Error(`Unsupported action type ${(action as RuleAction).type}.`);
    }
  }

  private resolveTarget(targetName?: string): MessageTarget {
    if (!targetName) {
      throw new Error("post_message action requires a target.");
    }

    const configuredTarget = this.dependencies.rules.targets?.[targetName];
    if (configuredTarget) {
      return {
        name: targetName,
        ...configuredTarget
      };
    }

    return {
      name: targetName,
      label: targetName
    };
  }

  private resolveExecutionKey(rule: RuleConfig, event: TriggerEvent, observation: EventObservation): string {
    const templateContext = this.buildTemplateContext(event, observation);
    return renderTemplate(rule.dedupeKey ?? `${rule.id}:${event.id}`, templateContext);
  }

  private recordDecision(
    input: {
      rule: RuleConfig;
      event: TriggerEvent;
      executionKey: string;
      actionCount: number;
      startedAt: string;
      status: "executed" | "skipped";
      reason: string;
    },
    metadata: Record<string, unknown>
  ): RuleExecutionResult {
    this.recordHistory(input);
    this.dependencies.logger.info("Rule decision", {
      ...metadata,
      status: input.status,
      reason: input.reason
    });

    return {
      ruleId: input.rule.id,
      executed: input.status === "executed",
      reason: input.reason,
      executionKey: input.executionKey
    };
  }

  private recordHistory(input: {
    rule: RuleConfig;
    event: TriggerEvent;
    executionKey: string;
    actionCount: number;
    startedAt: string;
    status: "executed" | "skipped" | "failed";
    reason: string;
  }): void {
    this.dependencies.state.recordRuleExecution({
      ruleId: input.rule.id,
      eventId: input.event.id,
      trigger: input.event.trigger,
      executionKey: input.executionKey,
      status: input.status,
      reason: input.reason,
      actionCount: input.actionCount,
      startedAt: input.startedAt,
      completedAt: new Date().toISOString(),
      payload: (input.event.payload as Record<string, unknown>) ?? {}
    });
  }
}
