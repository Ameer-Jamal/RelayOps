import { Command } from "commander";
import { createRelayOpsApplication } from "../core/application";
import type { RuleTrigger } from "../types";

async function run(): Promise<void> {
  const program = new Command();
  program.name("relayops").description("RelayOps CLI");

  program
    .command("start")
    .description("Start the scheduler and local API")
    .action(async () => {
      const app = createRelayOpsApplication();
      await app.start();
      const shutdown = async () => {
        await app.stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);
    });

  program
    .command("run-trigger")
    .description("Run a trigger once")
    .argument("<trigger>", "new_pr | unread_message | manual")
    .action(async (trigger: RuleTrigger) => {
      const app = createRelayOpsApplication();
      try {
        const result = await app.runTrigger(trigger);
        process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      } finally {
        await app.stop();
      }
    });

  program
    .command("alerts-clear")
    .description("Clear active alerts")
    .action(async () => {
      const app = createRelayOpsApplication();
      try {
        const cleared = await app.clearAlerts();
        process.stdout.write(`${JSON.stringify({ cleared }, null, 2)}\n`);
      } finally {
        await app.stop();
      }
    });

  program
    .command("alerts-ack")
    .description("Acknowledge an active alert")
    .requiredOption("--key <key>", "alert dedupe key")
    .option("--by <by>", "acknowledging actor")
    .action(async (options: { key: string; by?: string }) => {
      const app = createRelayOpsApplication();
      try {
        const acknowledged = app.acknowledgeAlert(options.key, options.by);
        process.stdout.write(`${JSON.stringify({ acknowledged }, null, 2)}\n`);
      } finally {
        await app.stop();
      }
    });

  program
    .command("state")
    .description("Dump the latest state snapshot")
    .action(async () => {
      const app = createRelayOpsApplication();
      try {
        process.stdout.write(`${JSON.stringify(app.snapshotState(), null, 2)}\n`);
      } finally {
        await app.stop();
      }
    });

  program
    .command("teams-send")
    .description("Send a Teams message to a configured target")
    .requiredOption("--target <target>", "target key from rules config")
    .requiredOption("--text <text>", "message text")
    .action(async (options: { target: string; text: string }) => {
      const app = createRelayOpsApplication();
      try {
        await app.teamsSend(options.target, options.text);
      } finally {
        await app.stop();
      }
    });

  program
    .command("teams-read")
    .description("Read recent messages from a configured target")
    .requiredOption("--target <target>", "target key from rules config")
    .option("--limit <limit>", "number of messages", "10")
    .action(async (options: { target: string; limit: string }) => {
      const app = createRelayOpsApplication();
      try {
        const messages = await app.teamsRead(options.target, Number.parseInt(options.limit, 10));
        process.stdout.write(`${JSON.stringify(messages, null, 2)}\n`);
      } finally {
        await app.stop();
      }
    });

  program
    .command("teams-validate")
    .description("Validate the current Teams session")
    .option("--wait", "pause and wait for manual login")
    .action(async (options: { wait?: boolean }) => {
      const app = createRelayOpsApplication();
      try {
        await app.validateTeamsSession(Boolean(options.wait));
        process.stdout.write(`${JSON.stringify({ ok: true }, null, 2)}\n`);
      } finally {
        await app.stop();
      }
    });

  await program.parseAsync(process.argv);
}

run().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
