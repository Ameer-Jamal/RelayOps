import notifier from "node-notifier";
import type { AlertAdapter, AlertPayload, AppConfig, Logger } from "../../types";

export class LocalAlertAdapter implements AlertAdapter {
  constructor(
    private readonly logger: Logger,
    private readonly config: AppConfig
  ) {}

  async trigger(alert: AlertPayload): Promise<void> {
    if (!this.config.alerts.enabled) {
      this.logger.info("Alert delivery skipped because alerts are disabled", {
        dedupeKey: alert.dedupeKey
      });
      return;
    }

    try {
      notifier.notify({
        title: alert.title ?? "RelayOps Alert",
        message: alert.message,
        sound: this.config.alerts.soundEnabled,
        wait: false
      });
    } catch (error) {
      this.logger.warn("Desktop notification delivery failed, falling back to terminal bell", {
        error: error instanceof Error ? error.message : String(error)
      });
      process.stdout.write("\u0007");
    }

    this.logger.info("Alert triggered", {
      dedupeKey: alert.dedupeKey,
      severity: alert.severity
    });
  }

  async clearAll(): Promise<void> {
    this.logger.info("Alert clear requested");
  }
}
