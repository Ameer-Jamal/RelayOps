export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: {
    message: string;
    code?: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export type AdminLogLevel = "debug" | "info" | "warn" | "error";

export interface AdminLogEntry {
  ts: string;
  level: AdminLogLevel;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface SetupConfigView {
  envFilePath: string;
  rulesFilePath: string;
  browserProfileDir: string;
  browserHeadless: boolean;
  captureScreenshots: boolean;
  teamsBaseUrl: string;
  databasePath: string;
  newPrIntervalMs: number;
  unreadMessageIntervalMs: number;
  validateSessionOnStartup: boolean;
  waitForLoginOnStartup: boolean;
  alertsEnabled: boolean;
  alertSoundEnabled: boolean;
  logLevel: AdminLogLevel;
}

export interface SetupConfigUpdateInput {
  browserProfileDir: string;
  browserHeadless: boolean;
  captureScreenshots: boolean;
  teamsBaseUrl: string;
  rulesFilePath: string;
  databasePath: string;
  newPrIntervalMs: number;
  unreadMessageIntervalMs: number;
  validateSessionOnStartup: boolean;
  waitForLoginOnStartup: boolean;
  alertsEnabled: boolean;
  alertSoundEnabled: boolean;
  logLevel: AdminLogLevel;
}

export interface TargetRecord {
  name: string;
  kind?: "chat" | "channel" | "unknown";
  label?: string;
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface RuleConditionRecord {
  type: "always" | "not_processed" | "older_than_minutes" | "cooldown_elapsed";
  minutes?: number;
  key?: string;
}

export interface RuleActionRecord {
  type: "post_message" | "alert" | "clear_alerts";
  target?: string;
  template?: string;
  title?: string;
  message?: string;
  severity?: "info" | "warning" | "error";
}

export interface RuleRecord {
  id: string;
  enabled?: boolean;
  trigger: "new_pr" | "unread_message" | "manual";
  condition?: RuleConditionRecord;
  conditions?: RuleConditionRecord[];
  action?: RuleActionRecord;
  actions?: RuleActionRecord[];
  cooldownMinutes?: number;
  dedupeKey?: string;
}

export interface RulesConfigView {
  filePath: string;
  rawYaml: string;
  targets: TargetRecord[];
  rules: RuleRecord[];
  usingExampleSource: boolean;
}

export interface AdminAlertRecord {
  dedupeKey: string;
  severity: "info" | "warning" | "error";
  title?: string;
  message: string;
  status: "active" | "acknowledged" | "cleared";
  triggeredAt: string;
  lastTriggeredAt: string;
  clearedAt?: string | null;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  triggerCount: number;
}

export interface AdminRuleExecutionRecord {
  ruleId: string;
  eventId: string;
  trigger: "new_pr" | "unread_message" | "manual";
  executionKey: string;
  status: "executed" | "skipped" | "failed";
  reason: string;
  actionCount: number;
  startedAt: string;
  completedAt: string;
}

export interface LastRunSummary {
  trigger: "new_pr" | "unread_message" | "manual";
  lastExecutedAt?: string;
  lastFailedAt?: string;
}

export interface DashboardStatus {
  relayOpsRunning: boolean;
  serverHost: string;
  serverPort: number;
  browserProfileConfigured: boolean;
  browserProfileDir: string;
  databasePath: string;
  databaseReachable: boolean;
  rulesFilePath: string;
  rulesCount: number;
  targetsCount: number;
  activeAlertsCount: number;
  acknowledgedAlertsCount: number;
  teams: {
    configured: boolean;
    sessionStatus: "ready" | "logged_out" | "unknown";
    baseUrl: string;
  };
  lastRuns: LastRunSummary[];
  lastError?: AdminLogEntry;
  recentActivity: AdminLogEntry[];
}

export interface ValidationResult {
  valid: boolean;
  issues: Array<{
    field: string;
    message: string;
  }>;
}

export interface ManualActionResult {
  message: string;
  details?: Record<string, unknown>;
}
