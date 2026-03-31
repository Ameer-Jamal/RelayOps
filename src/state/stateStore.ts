import Database from "better-sqlite3";
import type {
  AlertPayload,
  EventObservation,
  RuleExecutionHistoryRecord,
  RuleTrigger,
  StateSnapshot,
  StateStore,
  TriggerEvent
} from "../types";

export class SqliteStateStore implements StateStore {
  private readonly database: Database.Database;

  constructor(private readonly databasePath: string) {
    this.database = new Database(databasePath);
  }

  initialize(): void {
    this.database.pragma("busy_timeout = 5000");
    this.database.pragma("journal_mode = WAL");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS processed_events (
        rule_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        execution_key TEXT,
        event_occurred_at TEXT NOT NULL,
        processed_at TEXT NOT NULL,
        payload_json TEXT,
        PRIMARY KEY (rule_id, event_id)
      );

      CREATE TABLE IF NOT EXISTS event_observations (
        event_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        first_seen_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        payload_json TEXT,
        PRIMARY KEY (event_id, trigger)
      );

      CREATE TABLE IF NOT EXISTS execution_keys (
        execution_key TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        first_claimed_at TEXT NOT NULL,
        last_claimed_at TEXT NOT NULL,
        completed_at TEXT,
        failed_at TEXT,
        failure_reason TEXT,
        payload_json TEXT
      );

      CREATE TABLE IF NOT EXISTS rule_execution_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        trigger TEXT NOT NULL,
        execution_key TEXT NOT NULL,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        action_count INTEGER NOT NULL,
        started_at TEXT NOT NULL,
        completed_at TEXT NOT NULL,
        payload_json TEXT
      );

      CREATE TABLE IF NOT EXISTS alerts (
        dedupe_key TEXT PRIMARY KEY,
        severity TEXT NOT NULL,
        title TEXT,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        triggered_at TEXT NOT NULL,
        last_triggered_at TEXT NOT NULL,
        cleared_at TEXT,
        acknowledged_at TEXT,
        acknowledged_by TEXT,
        trigger_count INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT
      );

      CREATE TABLE IF NOT EXISTS cooldowns (
        cooldown_key TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);

    this.execSafe(`ALTER TABLE processed_events ADD COLUMN execution_key TEXT;`);
    this.execSafe(`ALTER TABLE processed_events ADD COLUMN event_occurred_at TEXT;`);
    this.execSafe(`ALTER TABLE alerts ADD COLUMN last_triggered_at TEXT;`);
    this.execSafe(`ALTER TABLE alerts ADD COLUMN acknowledged_at TEXT;`);
    this.execSafe(`ALTER TABLE alerts ADD COLUMN acknowledged_by TEXT;`);
    this.execSafe(`ALTER TABLE alerts ADD COLUMN trigger_count INTEGER NOT NULL DEFAULT 1;`);

    this.database
      .prepare(
        `
          UPDATE processed_events
          SET event_occurred_at = COALESCE(event_occurred_at, processed_at)
          WHERE event_occurred_at IS NULL
        `
      )
      .run();

    this.database
      .prepare(
        `
          UPDATE alerts
          SET last_triggered_at = COALESCE(last_triggered_at, triggered_at)
          WHERE last_triggered_at IS NULL
        `
      )
      .run();
  }

  close(): void {
    this.database.close();
  }

  observeEvent(event: TriggerEvent): EventObservation {
    const now = new Date().toISOString();
    const existing = this.database
      .prepare(
        `
          SELECT event_id, trigger, first_seen_at, last_seen_at
          FROM event_observations
          WHERE event_id = ? AND trigger = ?
        `
      )
      .get(event.id, event.trigger) as
      | { event_id: string; trigger: RuleTrigger; first_seen_at: string; last_seen_at: string }
      | undefined;

    if (existing) {
      this.database
        .prepare(
          `
            UPDATE event_observations
            SET last_seen_at = ?, payload_json = ?
            WHERE event_id = ? AND trigger = ?
          `
        )
        .run(now, JSON.stringify(event.payload ?? {}), event.id, event.trigger);

      return {
        eventId: existing.event_id,
        trigger: existing.trigger,
        firstSeenAt: existing.first_seen_at,
        lastSeenAt: now
      };
    }

    const firstSeenAt = event.occurredAt || now;
    this.database
      .prepare(
        `
          INSERT INTO event_observations (event_id, trigger, first_seen_at, last_seen_at, payload_json)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(event.id, event.trigger, firstSeenAt, now, JSON.stringify(event.payload ?? {}));

    return {
      eventId: event.id,
      trigger: event.trigger,
      firstSeenAt,
      lastSeenAt: now
    };
  }

  getObservation(eventId: string, trigger: RuleTrigger): EventObservation | undefined {
    const row = this.database
      .prepare(
        `
          SELECT event_id, trigger, first_seen_at, last_seen_at
          FROM event_observations
          WHERE event_id = ? AND trigger = ?
        `
      )
      .get(eventId, trigger) as
      | { event_id: string; trigger: RuleTrigger; first_seen_at: string; last_seen_at: string }
      | undefined;

    if (!row) {
      return undefined;
    }

    return {
      eventId: row.event_id,
      trigger: row.trigger,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at
    };
  }

  hasProcessed(ruleId: string, eventId: string): boolean {
    const row = this.database
      .prepare(
        `
          SELECT 1
          FROM processed_events
          WHERE rule_id = ? AND event_id = ?
        `
      )
      .get(ruleId, eventId) as { 1: number } | undefined;

    return Boolean(row);
  }

  markProcessed(ruleId: string, event: TriggerEvent): void {
    const executionKey = this.database
      .prepare(
        `
          SELECT execution_key
          FROM execution_keys
          WHERE rule_id = ? AND event_id = ?
          ORDER BY last_claimed_at DESC
          LIMIT 1
        `
      )
      .get(ruleId, event.id) as { execution_key?: string } | undefined;

    this.database
      .prepare(
        `
          INSERT INTO processed_events (
            rule_id,
            event_id,
            trigger,
            execution_key,
            event_occurred_at,
            processed_at,
            payload_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(rule_id, event_id) DO UPDATE SET
            execution_key = excluded.execution_key,
            event_occurred_at = excluded.event_occurred_at,
            processed_at = excluded.processed_at,
            payload_json = excluded.payload_json
        `
      )
      .run(
        ruleId,
        event.id,
        event.trigger,
        executionKey?.execution_key ?? null,
        event.occurredAt,
        new Date().toISOString(),
        JSON.stringify(event.payload ?? {})
      );
  }

  isCooldownActive(key: string): boolean {
    const row = this.database
      .prepare(
        `
          SELECT expires_at
          FROM cooldowns
          WHERE cooldown_key = ?
        `
      )
      .get(key) as { expires_at: string } | undefined;

    if (!row) {
      return false;
    }

    return new Date(row.expires_at).getTime() > Date.now();
  }

  setCooldown(key: string, minutes: number): void {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + minutes * 60_000).toISOString();

    this.database
      .prepare(
        `
          INSERT INTO cooldowns (cooldown_key, expires_at, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(cooldown_key) DO UPDATE SET
            expires_at = excluded.expires_at,
            updated_at = excluded.updated_at
        `
      )
      .run(key, expiresAt, now.toISOString());
  }

  beginExecution(ruleId: string, executionKey: string, event: TriggerEvent): boolean {
    const now = new Date().toISOString();
    const inserted = this.database
      .prepare(
        `
          INSERT INTO execution_keys (
            execution_key,
            rule_id,
            event_id,
            trigger,
            status,
            first_claimed_at,
            last_claimed_at,
            completed_at,
            failed_at,
            failure_reason,
            payload_json
          )
          VALUES (?, ?, ?, ?, 'in_progress', ?, ?, NULL, NULL, NULL, ?)
          ON CONFLICT(execution_key) DO NOTHING
        `
      )
      .run(executionKey, ruleId, event.id, event.trigger, now, now, JSON.stringify(event.payload ?? {}));

    if (inserted.changes > 0) {
      return true;
    }

    const existing = this.database
      .prepare(
        `
          SELECT status
          FROM execution_keys
          WHERE execution_key = ?
        `
      )
      .get(executionKey) as { status: string } | undefined;

    if (existing?.status !== "failed") {
      return false;
    }

    const retried = this.database
      .prepare(
        `
          UPDATE execution_keys
          SET
            status = 'in_progress',
            last_claimed_at = ?,
            completed_at = NULL,
            failed_at = NULL,
            failure_reason = NULL,
            payload_json = ?
          WHERE execution_key = ? AND status = 'failed'
        `
      )
      .run(now, JSON.stringify(event.payload ?? {}), executionKey);

    return retried.changes > 0;
  }

  completeExecution(executionKey: string): void {
    this.database
      .prepare(
        `
          UPDATE execution_keys
          SET status = 'completed', completed_at = ?, failure_reason = NULL
          WHERE execution_key = ?
        `
      )
      .run(new Date().toISOString(), executionKey);
  }

  failExecution(executionKey: string, reason: string): void {
    this.database
      .prepare(
        `
          UPDATE execution_keys
          SET status = 'failed', failed_at = ?, failure_reason = ?
          WHERE execution_key = ?
        `
      )
      .run(new Date().toISOString(), reason, executionKey);
  }

  recordRuleExecution(record: RuleExecutionHistoryRecord): void {
    this.database
      .prepare(
        `
          INSERT INTO rule_execution_history (
            rule_id,
            event_id,
            trigger,
            execution_key,
            status,
            reason,
            action_count,
            started_at,
            completed_at,
            payload_json
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        record.ruleId,
        record.eventId,
        record.trigger,
        record.executionKey,
        record.status,
        record.reason,
        record.actionCount,
        record.startedAt,
        record.completedAt,
        JSON.stringify(record.payload ?? {})
      );
  }

  recordAlert(alert: AlertPayload): boolean {
    const existing = this.database
      .prepare(
        `
          SELECT status
          FROM alerts
          WHERE dedupe_key = ?
        `
      )
      .get(alert.dedupeKey) as { status: string } | undefined;

    if (existing?.status === "active" || existing?.status === "acknowledged") {
      return false;
    }

    const now = new Date().toISOString();
    this.database
      .prepare(
        `
          INSERT INTO alerts (
            dedupe_key,
            severity,
            title,
            message,
            status,
            triggered_at,
            last_triggered_at,
            cleared_at,
            acknowledged_at,
            acknowledged_by,
            trigger_count,
            payload_json
          )
          VALUES (?, ?, ?, ?, 'active', ?, ?, NULL, NULL, NULL, 1, ?)
          ON CONFLICT(dedupe_key) DO UPDATE SET
            severity = excluded.severity,
            title = excluded.title,
            message = excluded.message,
            status = 'active',
            last_triggered_at = excluded.last_triggered_at,
            cleared_at = NULL,
            acknowledged_at = NULL,
            acknowledged_by = NULL,
            trigger_count = alerts.trigger_count + 1,
            payload_json = excluded.payload_json
        `
      )
      .run(
        alert.dedupeKey,
        alert.severity,
        alert.title ?? null,
        alert.message,
        now,
        now,
        JSON.stringify(alert.metadata ?? {})
      );

    return true;
  }

  acknowledgeAlert(dedupeKey: string, acknowledgedBy?: string): boolean {
    const result = this.database
      .prepare(
        `
          UPDATE alerts
          SET
            status = 'acknowledged',
            acknowledged_at = ?,
            acknowledged_by = ?,
            cleared_at = NULL
          WHERE dedupe_key = ? AND status = 'active'
        `
      )
      .run(new Date().toISOString(), acknowledgedBy ?? null, dedupeKey);

    return result.changes > 0;
  }

  acknowledgeAllAlerts(acknowledgedBy?: string): number {
    const result = this.database
      .prepare(
        `
          UPDATE alerts
          SET
            status = 'acknowledged',
            acknowledged_at = ?,
            acknowledged_by = ?,
            cleared_at = NULL
          WHERE status = 'active'
        `
      )
      .run(new Date().toISOString(), acknowledgedBy ?? null);

    return result.changes;
  }

  clearAlerts(): number {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `
          UPDATE alerts
          SET status = 'cleared', cleared_at = ?
          WHERE status IN ('active', 'acknowledged')
        `
      )
      .run(now);

    return result.changes;
  }

  snapshot(limit = 50): StateSnapshot {
    const processedEvents = this.database
      .prepare(
        `
          SELECT rule_id, event_id, trigger, execution_key, event_occurred_at, processed_at
          FROM processed_events
          ORDER BY processed_at DESC
          LIMIT ?
        `
      )
      .all(limit) as Array<Record<string, unknown>>;

    const observedEvents = this.database
      .prepare(
        `
          SELECT event_id, trigger, first_seen_at, last_seen_at
          FROM event_observations
          ORDER BY last_seen_at DESC
          LIMIT ?
        `
      )
      .all(limit) as Array<Record<string, unknown>>;

    const alerts = this.database
      .prepare(
        `
          SELECT
            dedupe_key,
            severity,
            title,
            message,
            status,
            triggered_at,
            last_triggered_at,
            cleared_at,
            acknowledged_at,
            acknowledged_by,
            trigger_count
          FROM alerts
          ORDER BY last_triggered_at DESC
          LIMIT ?
        `
      )
      .all(limit) as Array<Record<string, unknown>>;

    const cooldowns = this.database
      .prepare(
        `
          SELECT cooldown_key, expires_at, updated_at
          FROM cooldowns
          ORDER BY updated_at DESC
          LIMIT ?
        `
      )
      .all(limit) as Array<Record<string, unknown>>;

    const ruleExecutions = this.database
      .prepare(
        `
          SELECT rule_id, event_id, trigger, execution_key, status, reason, action_count, started_at, completed_at
          FROM rule_execution_history
          ORDER BY id DESC
          LIMIT ?
        `
      )
      .all(limit) as Array<Record<string, unknown>>;

    const executionKeys = this.database
      .prepare(
        `
          SELECT execution_key, rule_id, event_id, trigger, status, first_claimed_at, last_claimed_at, completed_at, failed_at, failure_reason
          FROM execution_keys
          ORDER BY last_claimed_at DESC
          LIMIT ?
        `
      )
      .all(limit) as Array<Record<string, unknown>>;

    return {
      processedEvents,
      observedEvents,
      alerts,
      cooldowns,
      ruleExecutions,
      executionKeys
    };
  }

  private execSafe(sql: string): void {
    try {
      this.database.exec(sql);
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes("duplicate column name")) {
        throw error;
      }
    }
  }
}
