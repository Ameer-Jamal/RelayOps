import type { Logger, RuleTrigger } from "../types";
import type { RelayOpsOrchestrator } from "./orchestrator";

export class TriggerScheduler {
  private readonly timers = new Map<RuleTrigger, NodeJS.Timeout>();
  private readonly inFlight = new Set<RuleTrigger>();

  constructor(
    private readonly orchestrator: RelayOpsOrchestrator,
    private readonly logger: Logger,
    private readonly scheduleConfig: {
      new_pr: number;
      unread_message: number;
    }
  ) {}

  start(): void {
    this.schedule("new_pr", this.scheduleConfig.new_pr);
    this.schedule("unread_message", this.scheduleConfig.unread_message);
  }

  stop(): void {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
    }

    this.timers.clear();
  }

  private schedule(trigger: RuleTrigger, intervalMs: number): void {
    if (trigger === "manual") {
      return;
    }

    if (this.timers.has(trigger)) {
      return;
    }

    const timer = setInterval(async () => {
      if (this.inFlight.has(trigger)) {
        this.logger.warn("Skipping trigger run because the previous run is still active", { trigger });
        return;
      }

      this.inFlight.add(trigger);
      try {
        await this.orchestrator.runTrigger(trigger);
      } catch (error) {
        this.logger.error("Scheduled trigger failed", {
          trigger,
          error: error instanceof Error ? error.message : String(error)
        });
      } finally {
        this.inFlight.delete(trigger);
      }
    }, intervalMs);

    this.timers.set(trigger, timer);
    this.logger.info("Scheduled trigger", { trigger, intervalMs });
  }
}
