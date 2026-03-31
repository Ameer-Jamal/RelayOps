export type LogLevel = "debug" | "info" | "warn" | "error";

export interface AppConfig {
  appName: string;
  logLevel: LogLevel;
  hasLocalEnvFile: boolean;
  dataDir: string;
  databasePath: string;
  rulesFile: string;
  server: {
    enabled: boolean;
    host: string;
    port: number;
  };
  scheduler: {
    enabled: boolean;
    newPrIntervalMs: number;
    unreadMessageIntervalMs: number;
  };
  browser: {
    headless: boolean;
    profileDir: string;
    screenshotsDir: string;
    captureScreenshots: boolean;
    channel?: string;
  };
  teams: {
    baseUrl: string;
    loginTimeoutMs: number;
    navigationTimeoutMs: number;
    selectorTimeoutMs: number;
    actionRetries: number;
    validateSessionOnStartup: boolean;
    waitForLoginOnStartup: boolean;
    loginPollIntervalMs: number;
  };
  prSource: {
    path?: string;
    url?: string;
    limit: number;
  };
  alerts: {
    enabled: boolean;
    soundEnabled: boolean;
  };
}

export interface MessageTarget {
  name?: string;
  kind?: "chat" | "channel" | "unknown";
  label?: string;
  url?: string;
}

export interface MessageRecord {
  id: string;
  target: MessageTarget;
  text: string;
  author?: string;
  timestamp: string;
  raw?: Record<string, unknown>;
}

export interface UnreadMessageRecord {
  id: string;
  label: string;
  target?: MessageTarget;
  url?: string;
  timestamp: string;
  raw?: Record<string, unknown>;
}

export interface PullRequestRecord {
  id: string;
  title: string;
  author: string;
  url: string;
  repository?: string;
  description?: string;
  createdAt: string;
  raw?: Record<string, unknown>;
}

export interface AlertPayload {
  dedupeKey: string;
  severity: "info" | "warning" | "error";
  title?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface SummaryResult {
  text: string;
  metadata?: Record<string, unknown>;
}

export interface MessagingAdapter {
  postMessage(target: MessageTarget, text: string): Promise<void>;
  readMessages(target: MessageTarget, limit?: number): Promise<MessageRecord[]>;
  readUnread(): Promise<UnreadMessageRecord[]>;
}

export interface AlertAdapter {
  trigger(alert: AlertPayload): Promise<void>;
  clearAll(): Promise<void>;
}

export interface SummaryAdapter {
  summarize(input: PullRequestRecord): Promise<SummaryResult>;
}

export interface PullRequestAdapter {
  readOpenPullRequests(limit?: number): Promise<PullRequestRecord[]>;
}

export type RuleTrigger = "new_pr" | "unread_message" | "manual";

export interface RuleCondition {
  type: "always" | "not_processed" | "older_than_minutes" | "cooldown_elapsed";
  minutes?: number;
  key?: string;
}

export interface RuleAction {
  type: "post_message" | "alert" | "clear_alerts";
  target?: string;
  template?: string;
  title?: string;
  message?: string;
  severity?: "info" | "warning" | "error";
}

export interface RuleConfig {
  id: string;
  enabled?: boolean;
  trigger: RuleTrigger;
  condition?: RuleCondition;
  conditions?: RuleCondition[];
  action?: RuleAction;
  actions?: RuleAction[];
  cooldownMinutes?: number;
  dedupeKey?: string;
}

export interface RulesFileConfig {
  targets?: Record<string, MessageTarget>;
  rules: RuleConfig[];
}

export interface TriggerEvent<TPayload = unknown> {
  trigger: RuleTrigger;
  id: string;
  occurredAt: string;
  payload: TPayload;
  source: string;
}

export interface EventObservation {
  eventId: string;
  trigger: RuleTrigger;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface StateSnapshot {
  processedEvents: Array<Record<string, unknown>>;
  observedEvents: Array<Record<string, unknown>>;
  alerts: Array<Record<string, unknown>>;
  cooldowns: Array<Record<string, unknown>>;
  ruleExecutions: Array<Record<string, unknown>>;
  executionKeys: Array<Record<string, unknown>>;
}

export interface RuleExecutionHistoryRecord {
  ruleId: string;
  eventId: string;
  trigger: RuleTrigger;
  executionKey: string;
  status: "executed" | "skipped" | "failed";
  reason: string;
  actionCount: number;
  startedAt: string;
  completedAt: string;
  payload?: Record<string, unknown>;
}

export interface ActionExecutionContext {
  config: AppConfig;
  rules: RulesFileConfig;
  rule: RuleConfig;
  executionKey: string;
  event: TriggerEvent;
  observation: EventObservation;
  state: StateStore;
  adapters: {
    messaging: MessagingAdapter;
    alerts: AlertAdapter;
    summaries: SummaryAdapter;
  };
  logger: Logger;
}

export interface Logger {
  debug(message: string, metadata?: Record<string, unknown>): void;
  info(message: string, metadata?: Record<string, unknown>): void;
  warn(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
}

export interface StateStore {
  initialize(): void;
  close(): void;
  observeEvent(event: TriggerEvent): EventObservation;
  hasProcessed(ruleId: string, eventId: string): boolean;
  markProcessed(ruleId: string, event: TriggerEvent): void;
  getObservation(eventId: string, trigger: RuleTrigger): EventObservation | undefined;
  isCooldownActive(key: string): boolean;
  setCooldown(key: string, minutes: number): void;
  beginExecution(ruleId: string, executionKey: string, event: TriggerEvent): boolean;
  completeExecution(executionKey: string): void;
  failExecution(executionKey: string, reason: string): void;
  recordRuleExecution(record: RuleExecutionHistoryRecord): void;
  recordAlert(alert: AlertPayload): boolean;
  acknowledgeAlert(dedupeKey: string, acknowledgedBy?: string): boolean;
  acknowledgeAllAlerts(acknowledgedBy?: string): number;
  clearAlerts(): number;
  snapshot(limit?: number): StateSnapshot;
}
