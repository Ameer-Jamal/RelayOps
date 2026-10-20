import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RelayOpsApplication } from "../../src/core/application";

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relayops-ui-"));
  fs.writeFileSync(path.join(dir, "rules.yaml"), "targets: {}\nrules: []\n");
  Object.assign(process.env, {
    RELAYOPS_DATA_DIR: dir, RELAYOPS_DB_PATH: path.join(dir, "state.db"),
    RELAYOPS_RULES_FILE: path.join(dir, "rules.yaml"),
    RELAYOPS_BROWSER_PROFILE_DIR: path.join(dir, "profile"), RELAYOPS_BROWSER_SCREENSHOTS_DIR: path.join(dir, "screenshots"),
    RELAYOPS_TEAMS_VALIDATE_SESSION_ON_STARTUP: "false", RELAYOPS_SCHEDULER_ENABLED: "false",
    RELAYOPS_SERVER_ENABLED: "true", RELAYOPS_SERVER_HOST: "127.0.0.1", RELAYOPS_SERVER_PORT: "4328",
    RELAYOPS_BITBUCKET_WORKSPACE: "", RELAYOPS_BITBUCKET_USERNAME: "", RELAYOPS_BITBUCKET_APP_PASSWORD: "",
    RELAYOPS_ALERTS_ENABLED: "false", RELAYOPS_LOG_LEVEL: "error"
  });
  const app = new RelayOpsApplication({ loggerOutput: "stderr" });
  const api = app.getTeamsAdapter().chatService;
  api.saveToken({ skypeToken: "", chatServiceToken: "synthetic-test-token", accountId: "synthetic-account", accountEmail: "demo@example.com", region: "emea", apiBaseUrl: "https://teams.cloud.microsoft/api/chatsvc/emea/v1" });
  api.fetchAllConversations = async () => ({ complete: true, conversations: [
    { id: "48:notes", topic: "", threadType: "streamofnotes" },
    { id: "19:team", topic: "Example Engineering", threadType: "space" },
    ...Array.from({ length: 2499 }, (_, i) => ({
      id: `19:destination-${i}`, topic: `Example destination ${String(i).padStart(4, "0")}`,
      threadType: i % 5 === 0 ? "topic" : "chat", spaceId: i % 5 === 0 ? "19:team" : undefined
    }))
  ] });
  app.teamsSend = async () => { throw new Error("Live sends are disabled in the UI test fixture."); };
  await app.getTeamsDirectory({ refresh: true });
  await app.start();
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    await app.stop(); fs.rmSync(dir, { recursive: true, force: true }); process.exit(0);
  };
  process.on("SIGINT", () => { void shutdown(); });
  process.on("SIGTERM", () => { void shutdown(); });
}
main().catch(error => { console.error(error); process.exit(1); });
