import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("MCP starts outside repo, keeps stdout clean, validates inputs, and preserves guards", async t => {
  const root = path.resolve(__dirname, "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relayops-mcp-"));
  const rules = path.join(dir, "rules.yaml");
  fs.writeFileSync(rules, `targets: {}\nrules:\n  - id: test\n    trigger: manual\n    dedupeKey: mcp-test\n    cooldownMinutes: 60\n    actions:\n      - type: clear_alerts\n`);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), path.join(root, "src/mcp/index.ts")],
    cwd: dir,
    stderr: "pipe",
    env: {
      ...process.env as Record<string, string>,
      RELAYOPS_DATA_DIR: dir,
      RELAYOPS_DB_PATH: path.join(dir, "state.db"),
      RELAYOPS_BROWSER_PROFILE_DIR: path.join(dir, "profile"),
      RELAYOPS_BROWSER_SCREENSHOTS_DIR: path.join(dir, "screenshots"),
      RELAYOPS_RULES_FILE: rules,
      RELAYOPS_ALERTS_ENABLED: "false"
    }
  });
  transport.stderr?.on("data", () => {});
  const client = new Client({ name: "test", version: "1.0.0" });
  const errors: Error[] = [];
  client.onerror = error => { errors.push(error); };
  t.after(async () => { await client.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await client.connect(transport);
  assert.ok((await client.listTools()).tools.some((tool) => tool.name === "teams_search_destinations"));
  const status = await client.callTool({ name: "relayops_get_status", arguments: {} });
  assert.equal(JSON.parse((status.content as any)[0].text).databaseReachable, true);
  const invalid = await client.callTool({ name: "teams_read_messages", arguments: { target: "48:notes", limit: -1 } });
  assert.equal(invalid.isError, true);
  const run = async () => {
    const result = await client.callTool({ name: "relayops_run_trigger", arguments: { trigger: "manual" } });
    assert.ok(!result.isError);
    return JSON.parse((result.content as any)[0].text);
  };
  assert.equal((await run()).rulesExecuted, 1);
  const again = await run();
  assert.equal(again.rulesExecuted, 0);
  assert.equal(again.rulesSkipped, 1);
  assert.deepEqual(errors, []);
});
