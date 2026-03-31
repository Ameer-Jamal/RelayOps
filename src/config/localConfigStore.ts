import fs from "node:fs";
import path from "node:path";
import { parse as parseDotEnv } from "dotenv";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { RulesFileConfig } from "../types";
import type { SetupConfigUpdateInput, SetupConfigView } from "../shared/adminApi";

const ENV_KEY_ORDER = [
  "RELAYOPS_APP_NAME",
  "RELAYOPS_LOG_LEVEL",
  "RELAYOPS_DATA_DIR",
  "RELAYOPS_DB_PATH",
  "RELAYOPS_RULES_FILE",
  "RELAYOPS_SERVER_ENABLED",
  "RELAYOPS_SERVER_HOST",
  "RELAYOPS_SERVER_PORT",
  "RELAYOPS_SCHEDULER_ENABLED",
  "RELAYOPS_NEW_PR_INTERVAL_MS",
  "RELAYOPS_UNREAD_MESSAGE_INTERVAL_MS",
  "RELAYOPS_BROWSER_HEADLESS",
  "RELAYOPS_BROWSER_PROFILE_DIR",
  "RELAYOPS_BROWSER_CAPTURE_SCREENSHOTS",
  "RELAYOPS_BROWSER_SCREENSHOTS_DIR",
  "RELAYOPS_BROWSER_CHANNEL",
  "RELAYOPS_TEAMS_BASE_URL",
  "RELAYOPS_TEAMS_LOGIN_TIMEOUT_MS",
  "RELAYOPS_TEAMS_NAVIGATION_TIMEOUT_MS",
  "RELAYOPS_TEAMS_SELECTOR_TIMEOUT_MS",
  "RELAYOPS_TEAMS_ACTION_RETRIES",
  "RELAYOPS_TEAMS_VALIDATE_SESSION_ON_STARTUP",
  "RELAYOPS_TEAMS_WAIT_FOR_LOGIN_ON_STARTUP",
  "RELAYOPS_TEAMS_LOGIN_POLL_INTERVAL_MS",
  "RELAYOPS_PR_SOURCE_PATH",
  "RELAYOPS_PR_SOURCE_URL",
  "RELAYOPS_PR_SOURCE_LIMIT",
  "RELAYOPS_ALERTS_ENABLED",
  "RELAYOPS_ALERTS_SOUND_ENABLED"
] as const;

export interface RulesFileSnapshot {
  filePath: string;
  rawYaml: string;
  config: RulesFileConfig;
  usingExampleSource: boolean;
}

export class LocalConfigStore {
  constructor(private readonly cwd: string) {}

  getEnvFilePath(): string {
    return path.join(this.cwd, ".env");
  }

  getDefaultEditableRulesFilePath(): string {
    return path.join(this.cwd, "rules.local.yaml");
  }

  loadEnvValues(): Record<string, string> {
    const envFilePath = this.getEnvFilePath();
    if (!fs.existsSync(envFilePath)) {
      return {};
    }

    return parseDotEnv(fs.readFileSync(envFilePath, "utf8"));
  }

  buildSetupView(input: {
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
    logLevel: SetupConfigView["logLevel"];
  }): SetupConfigView {
    return input;
  }

  saveSetupConfig(input: SetupConfigUpdateInput): string {
    const envValues = this.loadEnvValues();
    envValues.RELAYOPS_BROWSER_PROFILE_DIR = this.toPortablePath(input.browserProfileDir);
    envValues.RELAYOPS_BROWSER_HEADLESS = String(input.browserHeadless);
    envValues.RELAYOPS_BROWSER_CAPTURE_SCREENSHOTS = String(input.captureScreenshots);
    envValues.RELAYOPS_TEAMS_BASE_URL = input.teamsBaseUrl;
    envValues.RELAYOPS_RULES_FILE = this.toPortablePath(input.rulesFilePath);
    envValues.RELAYOPS_DB_PATH = this.toPortablePath(input.databasePath);
    envValues.RELAYOPS_NEW_PR_INTERVAL_MS = String(input.newPrIntervalMs);
    envValues.RELAYOPS_UNREAD_MESSAGE_INTERVAL_MS = String(input.unreadMessageIntervalMs);
    envValues.RELAYOPS_TEAMS_VALIDATE_SESSION_ON_STARTUP = String(input.validateSessionOnStartup);
    envValues.RELAYOPS_TEAMS_WAIT_FOR_LOGIN_ON_STARTUP = String(input.waitForLoginOnStartup);
    envValues.RELAYOPS_ALERTS_ENABLED = String(input.alertsEnabled);
    envValues.RELAYOPS_ALERTS_SOUND_ENABLED = String(input.alertSoundEnabled);
    envValues.RELAYOPS_LOG_LEVEL = input.logLevel;
    this.writeEnvValues(envValues);
    return this.getEnvFilePath();
  }

  loadRulesFile(activeRulesFilePath: string): RulesFileSnapshot {
    const usingExampleSource = path.basename(activeRulesFilePath) === "rules.example.yaml";
    const existingPath = fs.existsSync(activeRulesFilePath)
      ? activeRulesFilePath
      : this.getDefaultEditableRulesFilePath();
    const rawYaml = fs.existsSync(existingPath) ? fs.readFileSync(existingPath, "utf8") : "targets: {}\nrules: []\n";
    const parsed = (parseYaml(rawYaml) as RulesFileConfig | null) ?? { targets: {}, rules: [] };

    return {
      filePath: existingPath,
      rawYaml,
      config: {
        targets: parsed.targets ?? {},
        rules: parsed.rules ?? []
      },
      usingExampleSource
    };
  }

  saveRulesFile(activeRulesFilePath: string, config: RulesFileConfig): RulesFileSnapshot {
    const targetPath =
      path.basename(activeRulesFilePath) === "rules.example.yaml"
        ? this.getDefaultEditableRulesFilePath()
        : activeRulesFilePath;
    const nextRawYaml = stringifyYaml({
      targets: config.targets ?? {},
      rules: config.rules ?? []
    });
    fs.writeFileSync(targetPath, nextRawYaml, "utf8");

    const envValues = this.loadEnvValues();
    envValues.RELAYOPS_RULES_FILE = this.toPortablePath(targetPath);
    this.writeEnvValues(envValues);

    return {
      filePath: targetPath,
      rawYaml: nextRawYaml,
      config,
      usingExampleSource: false
    };
  }

  private writeEnvValues(envValues: Record<string, string>): void {
    const outputLines: string[] = [];
    const seen = new Set<string>();

    for (const key of ENV_KEY_ORDER) {
      if (envValues[key] === undefined) {
        continue;
      }

      outputLines.push(`${key}=${envValues[key]}`);
      seen.add(key);
    }

    for (const [key, value] of Object.entries(envValues).sort(([left], [right]) => left.localeCompare(right))) {
      if (seen.has(key)) {
        continue;
      }

      outputLines.push(`${key}=${value}`);
    }

    fs.writeFileSync(this.getEnvFilePath(), `${outputLines.join("\n")}\n`, "utf8");
  }

  private toPortablePath(inputPath: string): string {
    const absolutePath = path.resolve(this.cwd, inputPath);
    const relativePath = path.relative(this.cwd, absolutePath);
    if (!relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
      return relativePath || ".";
    }

    return absolutePath;
  }
}
