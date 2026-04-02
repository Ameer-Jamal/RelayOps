import { createPullRequestAdapter } from "../adapters/git/pullRequestAdapterFactory";
import path from "node:path";
import { LocalAlertAdapter } from "../adapters/notifications/localAlertAdapter";
import { TeamsWebAdapter } from "../adapters/teams/teamsWebAdapter";
import { PlaceholderSummaryAdapter } from "../adapters/ai/placeholderSummaryAdapter";
import { PlaywrightBrowserManager } from "../adapters/browser/playwrightBrowser";
import { ensureRuntimeDirectories, loadAppConfig, loadRulesConfig } from "../config/appConfig";
import { LocalConfigStore } from "../config/localConfigStore";
import type {
  AppConfig,
  Logger,
  MessageRecord,
  PullRequestAdapter,
  RuleConfig,
  RuleTrigger,
  RulesFileConfig,
  StateSnapshot,
  TriggerRunOptions
} from "../types";
import type {
  AdminAlertRecord,
  AdminLogEntry,
  AdminRuleExecutionRecord,
  DashboardStatus,
  RulesConfigView,
  SetupConfigUpdateInput,
  SetupConfigView,
  TargetRecord,
  ValidationResult
} from "../shared/adminApi";
import { RelayOpsServer } from "../server/appServer";
import { SqliteStateStore } from "../state/stateStore";
import { RelayLogger } from "./logger";
import { RelayOpsOrchestrator, type TriggerRunSummary } from "./orchestrator";
import { TriggerScheduler } from "./scheduler";
import { RulesEngine } from "../rules/rulesEngine";

export class RelayOpsApplication {
  readonly config: AppConfig;
  readonly rules: RulesFileConfig;
  readonly logger: Logger;
  private readonly relayLogger: RelayLogger;
  private readonly configStore: LocalConfigStore;
  private readonly browser: PlaywrightBrowserManager;
  private readonly stateStore: SqliteStateStore;
  private readonly teamsAdapter: TeamsWebAdapter;
  private readonly alertsAdapter: LocalAlertAdapter;
  private readonly prAdapter: PullRequestAdapter;
  private readonly summaryAdapter: PlaceholderSummaryAdapter;
  private readonly rulesEngine: RulesEngine;
  private readonly orchestrator: RelayOpsOrchestrator;
  private readonly scheduler: TriggerScheduler;
  private readonly server: RelayOpsServer;

  constructor() {
    this.config = loadAppConfig();
    ensureRuntimeDirectories(this.config);
    this.rules = loadRulesConfig(this.config.rulesFile);
    this.configStore = new LocalConfigStore(process.cwd());
    this.relayLogger = new RelayLogger(this.config.logLevel);
    this.logger = this.relayLogger;
    this.stateStore = new SqliteStateStore(this.config.databasePath);
    this.stateStore.initialize();
    this.browser = new PlaywrightBrowserManager(this.config, this.logger);
    this.teamsAdapter = new TeamsWebAdapter(this.browser, this.config, this.logger);
    this.alertsAdapter = new LocalAlertAdapter(this.logger, this.config);
    this.prAdapter = createPullRequestAdapter(this.config, this.logger);
    this.summaryAdapter = new PlaceholderSummaryAdapter();
    this.rulesEngine = new RulesEngine({
      config: this.config,
      rules: this.rules,
      state: this.stateStore,
      logger: this.logger,
      adapters: {
        messaging: this.teamsAdapter,
        alerts: this.alertsAdapter,
        summaries: this.summaryAdapter
      }
    });
    this.orchestrator = new RelayOpsOrchestrator({
      state: this.stateStore,
      rulesEngine: this.rulesEngine,
      messaging: this.teamsAdapter,
      pullRequests: this.prAdapter,
      logger: this.logger
    });
    this.scheduler = new TriggerScheduler(this.orchestrator, this.logger, {
      new_pr: this.config.scheduler.newPrIntervalMs,
      unread_message: this.config.scheduler.unreadMessageIntervalMs
    });
    this.server = new RelayOpsServer(this);
  }

  async start(): Promise<void> {
    if (!this.config.hasLocalEnvFile) {
      this.logger.info("Starting RelayOps in first-run setup mode", {
        schedulerEnabled: this.config.scheduler.enabled,
        validateSessionOnStartup: this.config.teams.validateSessionOnStartup
      });
    }

    let startupValidationFailed = false;
    if (this.config.teams.validateSessionOnStartup) {
      try {
        await this.teamsAdapter.validateSession({
          reason: "startup",
          waitForLogin: this.config.teams.waitForLoginOnStartup
        });
      } catch (error) {
        startupValidationFailed = true;
        this.logger.warn("Teams startup validation failed; continuing in degraded mode", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (this.config.scheduler.enabled && !startupValidationFailed) {
      this.scheduler.start();
    } else if (this.config.scheduler.enabled && startupValidationFailed) {
      this.logger.warn("Scheduler start skipped because Teams startup validation failed");
    }

    if (this.config.server.enabled) {
      await this.server.start();
      this.logger.info("RelayOps server started", {
        host: this.config.server.host,
        port: this.config.server.port
      });
    }
  }

  async stop(): Promise<void> {
    this.scheduler.stop();
    await this.server.stop();
    await this.browser.close();
    this.stateStore.close();
  }

  async runTrigger(trigger: RuleTrigger, options?: TriggerRunOptions): Promise<TriggerRunSummary> {
    return this.orchestrator.runTrigger(trigger, options);
  }

  async clearAlerts(): Promise<number> {
    const cleared = this.stateStore.clearAlerts();
    await this.alertsAdapter.clearAll();
    return cleared;
  }

  acknowledgeAlert(dedupeKey: string, acknowledgedBy?: string): boolean {
    return this.stateStore.acknowledgeAlert(dedupeKey, acknowledgedBy);
  }

  snapshotState(limit = 200): StateSnapshot {
    return this.stateStore.snapshot(limit);
  }

  getLogs(limit = 200): AdminLogEntry[] {
    return this.relayLogger.getEntries(limit);
  }

  getSetupConfig(): SetupConfigView {
    return this.configStore.buildSetupView({
      envFilePath: this.configStore.getEnvFilePath(),
      rulesFilePath: this.config.rulesFile,
      browserProfileDir: this.config.browser.profileDir,
      browserHeadless: this.config.browser.headless,
      captureScreenshots: this.config.browser.captureScreenshots,
      teamsBaseUrl: this.config.teams.baseUrl,
      databasePath: this.config.databasePath,
      newPrIntervalMs: this.config.scheduler.newPrIntervalMs,
      unreadMessageIntervalMs: this.config.scheduler.unreadMessageIntervalMs,
      validateSessionOnStartup: this.config.teams.validateSessionOnStartup,
      waitForLoginOnStartup: this.config.teams.waitForLoginOnStartup,
      alertsEnabled: this.config.alerts.enabled,
      alertSoundEnabled: this.config.alerts.soundEnabled,
      bitbucketWorkspace: this.config.bitbucket?.workspace ?? "",
      bitbucketUsername: this.config.bitbucket?.username ?? "",
      bitbucketRepositories: this.config.bitbucket?.repositorySlugs.join(", ") ?? "",
      bitbucketAuthorUuid: this.config.bitbucket?.authorUuid ?? "",
      bitbucketAppPasswordSet: Boolean(this.config.bitbucket?.appPassword),
      logLevel: this.config.logLevel
    });
  }

  saveSetupConfig(input: SetupConfigUpdateInput): { config: SetupConfigView; requiresRestart: boolean } {
    this.configStore.saveSetupConfig(input);
    this.config.browser.profileDir = path.resolve(process.cwd(), input.browserProfileDir);
    this.config.browser.headless = input.browserHeadless;
    this.config.browser.captureScreenshots = input.captureScreenshots;
    this.config.teams.baseUrl = input.teamsBaseUrl;
    this.config.rulesFile = path.resolve(process.cwd(), input.rulesFilePath);
    this.config.databasePath = path.resolve(process.cwd(), input.databasePath);
    this.config.scheduler.newPrIntervalMs = input.newPrIntervalMs;
    this.config.scheduler.unreadMessageIntervalMs = input.unreadMessageIntervalMs;
    this.config.teams.validateSessionOnStartup = input.validateSessionOnStartup;
    this.config.teams.waitForLoginOnStartup = input.waitForLoginOnStartup;
    this.config.alerts.enabled = input.alertsEnabled;
    this.config.alerts.soundEnabled = input.alertSoundEnabled;
    this.config.bitbucket =
      input.bitbucketWorkspace.trim() && input.bitbucketUsername.trim()
        ? {
            workspace: input.bitbucketWorkspace.trim(),
            username: input.bitbucketUsername.trim(),
            appPassword: input.bitbucketAppPassword?.trim() || this.config.bitbucket?.appPassword || "",
            repositorySlugs: input.bitbucketRepositories
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
            authorUuid: input.bitbucketAuthorUuid.trim() || undefined
          }
        : undefined;
    this.config.logLevel = input.logLevel;

    const persistedRules = this.configStore.loadRulesFile(this.config.rulesFile);
    this.config.rulesFile = persistedRules.filePath;
    this.applyRulesConfig(persistedRules.config);

    return {
      config: this.getSetupConfig(),
      requiresRestart: true
    };
  }

  getRulesConfigView(): RulesConfigView {
    const snapshot = this.configStore.loadRulesFile(this.config.rulesFile);
    return {
      filePath: snapshot.filePath,
      rawYaml: snapshot.rawYaml,
      usingExampleSource: snapshot.usingExampleSource,
      targets: this.mapTargetsToArray(snapshot.config),
      rules: snapshot.config.rules as RuleConfig[]
    };
  }

  saveTargets(targets: TargetRecord[]): RulesConfigView {
    const current = this.configStore.loadRulesFile(this.config.rulesFile);
    const nextConfig: RulesFileConfig = {
      targets: Object.fromEntries(
        targets.map((target) => [
          target.name,
          {
            kind: target.kind,
            label: target.label,
            url: target.url
          }
        ])
      ),
      rules: current.config.rules
    };
    return this.persistRulesConfig(nextConfig);
  }

  saveRules(rules: RuleConfig[]): RulesConfigView {
    const current = this.configStore.loadRulesFile(this.config.rulesFile);
    return this.persistRulesConfig({
      targets: current.config.targets,
      rules
    });
  }

  getAlerts(limit = 200): AdminAlertRecord[] {
    const snapshot = this.stateStore.snapshot(limit);
    return snapshot.alerts.map((row) => ({
      dedupeKey: String(row.dedupe_key),
      severity: row.severity as AdminAlertRecord["severity"],
      title: row.title ? String(row.title) : undefined,
      message: String(row.message),
      status: row.status as AdminAlertRecord["status"],
      triggeredAt: String(row.triggered_at),
      lastTriggeredAt: String(row.last_triggered_at),
      clearedAt: row.cleared_at ? String(row.cleared_at) : null,
      acknowledgedAt: row.acknowledged_at ? String(row.acknowledged_at) : null,
      acknowledgedBy: row.acknowledged_by ? String(row.acknowledged_by) : null,
      triggerCount: Number(row.trigger_count ?? 1)
    }));
  }

  acknowledgeAllAlerts(acknowledgedBy?: string): number {
    return this.stateStore.acknowledgeAllAlerts(acknowledgedBy);
  }

  getRuleExecutions(limit = 200): AdminRuleExecutionRecord[] {
    const snapshot = this.stateStore.snapshot(limit);
    return snapshot.ruleExecutions.map((row) => ({
      ruleId: String(row.rule_id),
      eventId: String(row.event_id),
      trigger: row.trigger as AdminRuleExecutionRecord["trigger"],
      executionKey: String(row.execution_key),
      status: row.status as AdminRuleExecutionRecord["status"],
      reason: String(row.reason),
      actionCount: Number(row.action_count),
      startedAt: String(row.started_at),
      completedAt: String(row.completed_at)
    }));
  }

  async getDashboardStatus(): Promise<DashboardStatus> {
    const alerts = this.getAlerts(200);
    const ruleExecutions = this.getRuleExecutions(200);
    const teamsSessionStatus = this.inspectTeamsSession();

    return {
      relayOpsRunning: true,
      serverHost: this.config.server.host,
      serverPort: this.config.server.port,
      browserProfileConfigured: Boolean(this.config.browser.profileDir),
      browserProfileDir: this.config.browser.profileDir,
      databasePath: this.config.databasePath,
      databaseReachable: true,
      rulesFilePath: this.config.rulesFile,
      rulesCount: this.rules.rules.length,
      targetsCount: Object.keys(this.rules.targets ?? {}).length,
      activeAlertsCount: alerts.filter((alert) => alert.status === "active").length,
      acknowledgedAlertsCount: alerts.filter((alert) => alert.status === "acknowledged").length,
      teams: {
        configured: Boolean(this.config.teams.baseUrl),
        sessionStatus: teamsSessionStatus,
        baseUrl: this.config.teams.baseUrl
      },
      lastRuns: this.buildLastRuns(ruleExecutions),
      lastError: this.relayLogger.getLastError(),
      recentActivity: this.relayLogger.getEntries(20)
    };
  }

  async teamsSend(targetName: string, text: string): Promise<void> {
    const target = this.rules.targets?.[targetName] ?? { label: targetName, name: targetName };
    await this.teamsAdapter.postMessage({ name: targetName, ...target }, text);
  }

  async teamsRead(targetName: string, limit = 10): Promise<MessageRecord[]> {
    const target = this.rules.targets?.[targetName] ?? { label: targetName, name: targetName };
    return this.teamsAdapter.readMessages({ name: targetName, ...target }, limit);
  }

  async validateTeamsSession(waitForLogin = false): Promise<void> {
    await this.teamsAdapter.validateSession({
      reason: "manual_validation",
      waitForLogin
    });
  }

  async openTeamsSession(): Promise<void> {
    await this.teamsAdapter.openSession();
  }

  validateConfig(): ValidationResult {
    const issues: ValidationResult["issues"] = [];
    if (!this.config.browser.profileDir.trim()) {
      issues.push({ field: "browserProfileDir", message: "Browser profile path is required." });
    }

    if (!this.config.teams.baseUrl.startsWith("http")) {
      issues.push({ field: "teamsBaseUrl", message: "Teams base URL must be a valid URL." });
    }

    if (!this.config.rulesFile.trim()) {
      issues.push({ field: "rulesFilePath", message: "Rules file path is required." });
    }

    try {
      const rulesSnapshot = this.configStore.loadRulesFile(this.config.rulesFile);
      if (rulesSnapshot.usingExampleSource) {
        issues.push({
          field: "rulesFilePath",
          message: "RelayOps is still using rules.example.yaml. Save local targets and rules before running automation."
        });
      }

      for (const [targetName, target] of Object.entries(rulesSnapshot.config.targets ?? {})) {
        if (/^example\b/i.test(target.label ?? "") || /example-placeholder/i.test(target.url ?? "")) {
          issues.push({
            field: `target:${targetName}`,
            message: `Target "${targetName}" still uses an example placeholder. Replace it with a real local Teams label or URL.`
          });
        }
      }
    } catch (error) {
      issues.push({
        field: "rulesFilePath",
        message: error instanceof Error ? error.message : String(error)
      });
    }

    if (!this.config.databasePath.trim()) {
      issues.push({ field: "databasePath", message: "Database path is required." });
    }

    const bitbucketWorkspace = this.config.bitbucket?.workspace?.trim() ?? "";
    const bitbucketUsername = this.config.bitbucket?.username?.trim() ?? "";
    const bitbucketPassword = this.config.bitbucket?.appPassword?.trim() ?? "";
    if (bitbucketWorkspace || bitbucketUsername || bitbucketPassword) {
      if (!bitbucketWorkspace) {
        issues.push({ field: "bitbucketWorkspace", message: "Bitbucket workspace is required when Bitbucket sync is enabled." });
      }
      if (!bitbucketUsername) {
        issues.push({ field: "bitbucketUsername", message: "Bitbucket username is required when Bitbucket sync is enabled." });
      }
      if (!bitbucketPassword) {
        issues.push({ field: "bitbucketAppPassword", message: "Bitbucket app password is required when Bitbucket sync is enabled." });
      }
    }

    return {
      valid: issues.length === 0,
      issues
    };
  }

  private persistRulesConfig(nextConfig: RulesFileConfig): RulesConfigView {
    const saved = this.configStore.saveRulesFile(this.config.rulesFile, nextConfig);
    this.config.rulesFile = saved.filePath;
    this.applyRulesConfig(saved.config);
    return this.getRulesConfigView();
  }

  private applyRulesConfig(nextConfig: RulesFileConfig): void {
    this.rules.targets = { ...(nextConfig.targets ?? {}) };
    this.rules.rules = [...nextConfig.rules];
  }

  private mapTargetsToArray(config: RulesFileConfig): TargetRecord[] {
    return Object.entries(config.targets ?? {}).map(([name, value]) => ({
      name,
      kind: value.kind,
      label: value.label,
      url: value.url
    }));
  }

  private inspectTeamsSession(): DashboardStatus["teams"]["sessionStatus"] {
    return this.teamsAdapter.getCachedSessionState();
  }

  private buildLastRuns(ruleExecutions: AdminRuleExecutionRecord[]): DashboardStatus["lastRuns"] {
    const triggers: DashboardStatus["lastRuns"][number]["trigger"][] = [
      "new_pr",
      "unread_message",
      "manual"
    ];

    return triggers.map((trigger) => {
      const matching = ruleExecutions.filter((execution) => execution.trigger === trigger);
      const lastExecuted = matching.find((execution) => execution.status === "executed");
      const lastFailed = matching.find((execution) => execution.status === "failed");
      return {
        trigger,
        lastExecutedAt: lastExecuted?.completedAt,
        lastFailedAt: lastFailed?.completedAt
      };
    });
  }
}

export function createRelayOpsApplication(): RelayOpsApplication {
  return new RelayOpsApplication();
}
