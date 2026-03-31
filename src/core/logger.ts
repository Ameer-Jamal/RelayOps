import type { LogLevel, Logger } from "../types";
import type { AdminLogEntry } from "../shared/adminApi";

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export class RelayLogger implements Logger {
  private readonly entries: AdminLogEntry[] = [];

  constructor(
    private readonly level: LogLevel,
    private readonly maxEntries = 500
  ) {}

  debug(message: string, metadata?: Record<string, unknown>): void {
    this.write("debug", message, metadata);
  }

  info(message: string, metadata?: Record<string, unknown>): void {
    this.write("info", message, metadata);
  }

  warn(message: string, metadata?: Record<string, unknown>): void {
    this.write("warn", message, metadata);
  }

  error(message: string, metadata?: Record<string, unknown>): void {
    this.write("error", message, metadata);
  }

  private write(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (levelOrder[level] < levelOrder[this.level]) {
      return;
    }

    const payload: AdminLogEntry = {
      ts: new Date().toISOString(),
      level,
      message,
      ...(metadata ? { metadata } : {})
    };

    this.entries.push(payload);
    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }

    const line = JSON.stringify(payload);

    if (level === "error") {
      process.stderr.write(`${line}\n`);
      return;
    }

    process.stdout.write(`${line}\n`);
  }

  getEntries(limit = 100): AdminLogEntry[] {
    return this.entries.slice(-limit).reverse();
  }

  getLastError(): AdminLogEntry | undefined {
    return [...this.entries].reverse().find((entry) => entry.level === "error" || entry.level === "warn");
  }
}
