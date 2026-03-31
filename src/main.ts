import { createRelayOpsApplication } from "./core/application";

async function main(): Promise<void> {
  const app = createRelayOpsApplication();
  await app.start();

  const shutdown = async () => {
    await app.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exit(1);
});
