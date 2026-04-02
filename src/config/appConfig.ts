import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";
import { parse } from "yaml";
import { z } from "zod";
import type { AppConfig, RulesFileConfig } from "../types";

loadEnv();

const envSchema = z.object({
  RELAYOPS_APP_NAME: z.string().default("RelayOps"),
  RELAYOPS_LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  RELAYOPS_DATA_DIR: z.string().default(".relayops"),
  RELAYOPS_DB_PATH: z.string().default(".relayops/state/relayops.db"),
  RELAYOPS_RULES_FILE: z.string().optional(),
  RELAYOPS_SERVER_ENABLED: z.string().default("true"),
  RELAYOPS_SERVER_HOST: z.string().default("127.0.0.1"),
  RELAYOPS_SERVER_PORT: z.string().default("4317"),
  RELAYOPS_SCHEDULER_ENABLED: z.string().default("false"),
  RELAYOPS_NEW_PR_INTERVAL_MS: z.string().default("60000"),
  RELAYOPS_UNREAD_MESSAGE_INTERVAL_MS: z.string().default("120000"),
  RELAYOPS_BROWSER_HEADLESS: z.string().default("false"),
  RELAYOPS_BROWSER_PROFILE_DIR: z.string().default(".relayops/browser-profile"),
  RELAYOPS_BROWSER_SCREENSHOTS_DIR: z.string().default(".relayops/screenshots"),
  RELAYOPS_BROWSER_CAPTURE_SCREENSHOTS: z.string().default("true"),
  RELAYOPS_BROWSER_CHANNEL: z.string().optional(),
  RELAYOPS_BROWSER_EXTRA_ARGS: z.string().optional().default(""),
  RELAYOPS_TEAMS_BASE_URL: z.string().default("https://teams.microsoft.com/"),
  RELAYOPS_TEAMS_LOGIN_TIMEOUT_MS: z.string().default("120000"),
  RELAYOPS_TEAMS_NAVIGATION_TIMEOUT_MS: z.string().default("45000"),
  RELAYOPS_TEAMS_SELECTOR_TIMEOUT_MS: z.string().default("4000"),
  RELAYOPS_TEAMS_ACTION_RETRIES: z.string().default("3"),
  RELAYOPS_TEAMS_VALIDATE_SESSION_ON_STARTUP: z.string().default("false"),
  RELAYOPS_TEAMS_WAIT_FOR_LOGIN_ON_STARTUP: z.string().default("false"),
  RELAYOPS_TEAMS_LOGIN_POLL_INTERVAL_MS: z.string().default("2000"),
  RELAYOPS_PR_SOURCE_PATH: z.string().optional(),
  RELAYOPS_PR_SOURCE_URL: z.string().optional(),
  RELAYOPS_PR_SOURCE_LIMIT: z.string().default("25"),
  RELAYOPS_BITBUCKET_WORKSPACE: z.string().optional().default(""),
  RELAYOPS_BITBUCKET_USERNAME: z.string().optional().default(""),
  RELAYOPS_BITBUCKET_APP_PASSWORD: z.string().optional().default(""),
  RELAYOPS_BITBUCKET_REPOSITORIES: z.string().optional().default(""),
  RELAYOPS_BITBUCKET_AUTHOR_UUID: z.string().optional().default(""),
  RELAYOPS_ALERTS_ENABLED: z.string().default("true"),
  RELAYOPS_ALERTS_SOUND_ENABLED: z.string().default("true")
});

function toBoolean(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

function toNumber(value: string, fieldName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`Expected ${fieldName} to be a number, received "${value}".`);
  }

  return parsed;
}

function resolveRulesFile(): string {
  if (process.env.RELAYOPS_RULES_FILE) {
    return path.resolve(process.cwd(), process.env.RELAYOPS_RULES_FILE);
  }

  const localRules = path.resolve(process.cwd(), "rules.local.yaml");
  if (fs.existsSync(localRules)) {
    return localRules;
  }

  return path.resolve(process.cwd(), "rules.example.yaml");
}

export function loadAppConfig(): AppConfig {
  const env = envSchema.parse(process.env);
  const envFilePath = path.resolve(process.cwd(), ".env");

  return {
    appName: env.RELAYOPS_APP_NAME,
    logLevel: env.RELAYOPS_LOG_LEVEL,
    hasLocalEnvFile: fs.existsSync(envFilePath),
    dataDir: path.resolve(process.cwd(), env.RELAYOPS_DATA_DIR),
    databasePath: path.resolve(process.cwd(), env.RELAYOPS_DB_PATH),
    rulesFile: resolveRulesFile(),
    server: {
      enabled: toBoolean(env.RELAYOPS_SERVER_ENABLED),
      host: env.RELAYOPS_SERVER_HOST,
      port: toNumber(env.RELAYOPS_SERVER_PORT, "RELAYOPS_SERVER_PORT")
    },
    scheduler: {
      enabled: toBoolean(env.RELAYOPS_SCHEDULER_ENABLED),
      newPrIntervalMs: toNumber(env.RELAYOPS_NEW_PR_INTERVAL_MS, "RELAYOPS_NEW_PR_INTERVAL_MS"),
      unreadMessageIntervalMs: toNumber(
        env.RELAYOPS_UNREAD_MESSAGE_INTERVAL_MS,
        "RELAYOPS_UNREAD_MESSAGE_INTERVAL_MS"
      )
    },
    browser: {
      headless: toBoolean(env.RELAYOPS_BROWSER_HEADLESS),
      profileDir: path.resolve(process.cwd(), env.RELAYOPS_BROWSER_PROFILE_DIR),
      screenshotsDir: path.resolve(process.cwd(), env.RELAYOPS_BROWSER_SCREENSHOTS_DIR),
      captureScreenshots: toBoolean(env.RELAYOPS_BROWSER_CAPTURE_SCREENSHOTS),
      channel: env.RELAYOPS_BROWSER_CHANNEL || undefined,
      extraArgs: env.RELAYOPS_BROWSER_EXTRA_ARGS.split(/\s+/u).filter(Boolean)
    },
    teams: {
      baseUrl: env.RELAYOPS_TEAMS_BASE_URL,
      loginTimeoutMs: toNumber(env.RELAYOPS_TEAMS_LOGIN_TIMEOUT_MS, "RELAYOPS_TEAMS_LOGIN_TIMEOUT_MS"),
      navigationTimeoutMs: toNumber(
        env.RELAYOPS_TEAMS_NAVIGATION_TIMEOUT_MS,
        "RELAYOPS_TEAMS_NAVIGATION_TIMEOUT_MS"
      ),
      selectorTimeoutMs: toNumber(
        env.RELAYOPS_TEAMS_SELECTOR_TIMEOUT_MS,
        "RELAYOPS_TEAMS_SELECTOR_TIMEOUT_MS"
      ),
      actionRetries: toNumber(env.RELAYOPS_TEAMS_ACTION_RETRIES, "RELAYOPS_TEAMS_ACTION_RETRIES"),
      validateSessionOnStartup: toBoolean(env.RELAYOPS_TEAMS_VALIDATE_SESSION_ON_STARTUP),
      waitForLoginOnStartup: toBoolean(env.RELAYOPS_TEAMS_WAIT_FOR_LOGIN_ON_STARTUP),
      loginPollIntervalMs: toNumber(
        env.RELAYOPS_TEAMS_LOGIN_POLL_INTERVAL_MS,
        "RELAYOPS_TEAMS_LOGIN_POLL_INTERVAL_MS"
      )
    },
    prSource: {
      path: env.RELAYOPS_PR_SOURCE_PATH
        ? path.resolve(process.cwd(), env.RELAYOPS_PR_SOURCE_PATH)
        : undefined,
      url: env.RELAYOPS_PR_SOURCE_URL || undefined,
      limit: toNumber(env.RELAYOPS_PR_SOURCE_LIMIT, "RELAYOPS_PR_SOURCE_LIMIT")
    },
    bitbucket: (() => {
      const workspace = env.RELAYOPS_BITBUCKET_WORKSPACE.trim();
      const username = env.RELAYOPS_BITBUCKET_USERNAME.trim();
      const appPassword = env.RELAYOPS_BITBUCKET_APP_PASSWORD.trim();
      if (!workspace || !username || !appPassword) {
        return undefined;
      }

      const repositorySlugs = env.RELAYOPS_BITBUCKET_REPOSITORIES.split(",")
        .map((slug) => slug.trim())
        .filter(Boolean);
      const authorUuid = env.RELAYOPS_BITBUCKET_AUTHOR_UUID.trim() || undefined;

      return {
        workspace,
        repositorySlugs,
        username,
        appPassword,
        authorUuid
      };
    })(),
    alerts: {
      enabled: toBoolean(env.RELAYOPS_ALERTS_ENABLED),
      soundEnabled: toBoolean(env.RELAYOPS_ALERTS_SOUND_ENABLED)
    }
  };
}

export function ensureRuntimeDirectories(config: AppConfig): void {
  const directories = [
    config.dataDir,
    path.dirname(config.databasePath),
    config.browser.profileDir,
    config.browser.screenshotsDir
  ];

  for (const directory of directories) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

export function loadRulesConfig(rulesFilePath: string): RulesFileConfig {
  if (!fs.existsSync(rulesFilePath)) {
    throw new Error(
      `Rules file not found at ${rulesFilePath}. Create one from rules.example.yaml or set RELAYOPS_RULES_FILE.`
    );
  }

  const fileContent = fs.readFileSync(rulesFilePath, "utf8");
  const parsed = parse(fileContent) as RulesFileConfig;

  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error(`Rules file ${rulesFilePath} must define a "rules" array.`);
  }

  return {
    targets: parsed.targets ?? {},
    rules: parsed.rules
  };
}
