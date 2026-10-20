import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TeamsChatService } from "../src/adapters/teams/teamsChatService";
import { cleanStaleChromiumLocks } from "../src/adapters/browser/teamsChromiumProfile";
import { TeamsTokenCapture } from "../src/adapters/teams/tokenCapture";
import { ActionLock } from "../src/core/actionLock";
import { SqliteStateStore } from "../src/state/stateStore";
import type { Logger } from "../src/types";

const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
function temporary(t: { after(fn: () => void): void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relayops-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test("targets resolve IDs and Teams links and reject ambiguous chats", t => {
  const service = new TeamsChatService(temporary(t), logger);
  assert.equal(service.resolveConversationId({ label: "48:notes" }), "48:notes");
  assert.equal(service.resolveConversationId({ label: "Myself" }), "48:notes");
  assert.equal(service.resolveConversationId({ label: "https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/General" }), "19:abc@thread.tacv2");
  assert.throws(() => service.resolveConversationId({ url: "https://other.example/l/chat/48:notes" }));
  assert.throws(() => service.resolveConversationId({ url: "https://teams.microsoft.com/l/chat/0/0?users=someone@example.com" }));
  const conversations = [{ id: "19:a", topic: "Dad", threadType: "chat" }, { id: "19:b", topic: "Dad", threadType: "chat" }];
  assert.throws(() => service.resolveConversationId({ label: "Dad" }, conversations), /Ambiguous/);
  assert.equal(service.resolveConversationId({ label: "Da" }, conversations), undefined);
});

test("active or unverified Chromium locks are preserved; dead local locks are cleaned together", t => {
  const dir = temporary(t);
  for (const [name, target] of Object.entries({ SingletonLock: `${os.hostname()}-${process.pid}`, SingletonSocket: "/tmp/nonexistent/SingletonSocket", SingletonCookie: "123456" })) fs.symlinkSync(target, path.join(dir, name));
  cleanStaleChromiumLocks(dir, logger);
  for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) assert.ok(fs.lstatSync(path.join(dir, name)));
  fs.unlinkSync(path.join(dir, "SingletonLock"));
  fs.symlinkSync("unrecognized-owner", path.join(dir, "SingletonLock"));
  cleanStaleChromiumLocks(dir, logger);
  assert.ok(fs.lstatSync(path.join(dir, "SingletonCookie")));
  fs.unlinkSync(path.join(dir, "SingletonLock"));
  // PID above the OS process limit is confirmed absent before exercising cleanup.
  const deadPid = 2_000_000_000;
  assert.throws(() => process.kill(deadPid, 0), { code: "ESRCH" });
  fs.symlinkSync(`${os.hostname()}-${deadPid}`, path.join(dir, "SingletonLock"));
  cleanStaleChromiumLocks(dir, logger);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test("token cache uses owner-only permissions and sees another process's refresh", t => {
  const dir = temporary(t);
  const first = new TeamsChatService(dir, logger);
  first.saveToken({ skypeToken: "old", region: "emea", expiresAt: Date.now() - 1000 });
  assert.equal(first.hasValidToken(), false);
  const second = new TeamsChatService(dir, logger);
  second.saveToken({ skypeToken: "new", expiresAt: Date.now() + 60_000 });
  assert.equal(first.getToken()?.skypeToken, "new");
  assert.equal(first.getToken()?.region, "emea");
  assert.equal(first.hasValidToken(), true);
  assert.equal(fs.statSync(path.join(dir, "teams-tokens.json")).mode & 0o777, 0o600);
});

test("network capture ignores unrelated authentication and attaches only once", async t => {
  const service = new TeamsChatService(temporary(t), logger);
  const capture = new TeamsTokenCapture(service, logger);
  const listeners: Record<string, Function> = {};
  let attachments = 0;
  const page = {
    on(event: string, listener: Function) { attachments++; listeners[event] = listener; },
    once() {},
    context() { return { cookies: async () => [], newCDPSession: async () => { throw new Error("unavailable"); } }; }
  };
  await capture.attach(page as any);
  await capture.attach(page as any);
  assert.equal(attachments, 1);
  const request = (url: string) => ({ url: () => url, headers: () => ({ "x-skypetoken": "test-token-longer-than-twenty-characters" }) });
  listeners.request!(request("https://other.example/api/mt/"));
  assert.equal(service.getToken(), undefined);
  listeners.request!(request("https://emea.ng.msg.teams.microsoft.com/v1/users/ME"));
  assert.equal(service.getToken()?.region, "emea");
});

test("send escapes plain text and never silently retries uncertain delivery", async t => {
  const service = new TeamsChatService(temporary(t), logger);
  service.saveToken({ skypeToken: "test", region: "amer" });
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, options: RequestInit) => {
    calls++;
    const payload = JSON.parse(options.body as string);
    assert.equal(payload.content, "<p>A &lt; B &amp; C<br/>next</p>");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal);
    return new Response("{}", { status: 503 });
  }) as typeof fetch;
  await assert.rejects(service.postMessage({ label: "48:notes" }, "A < B & C\nnext"), /no automatic resend/);
  assert.equal(calls, 1);
});

test("action lock prevents overlapping browser operations and releases after failure", async () => {
  const lock = new ActionLock();
  let release!: () => void;
  const active = lock.runExclusive("first", () => new Promise<void>(r => { release = r; }));
  await assert.rejects(lock.runExclusive("second", async () => {}), /busy/);
  release();
  await active;
  await assert.rejects(lock.runExclusive("fail", async () => { throw new Error("expected"); }));
  await lock.runExclusive("next", async () => {});
});

test("SQLite execution keys suppress duplicate claims and permit failed retry", t => {
  const state = new SqliteStateStore(path.join(temporary(t), "test.db"));
  state.initialize();
  t.after(() => state.close());
  const event = { trigger: "manual" as const, source: "test", id: "test", payload: {}, occurredAt: new Date().toISOString() };
  assert.equal(state.beginExecution("rule", "execution", event), true);
  assert.equal(state.beginExecution("rule", "execution", event), false);
  state.failExecution("execution", "temporary failure");
  assert.equal(state.beginExecution("rule", "execution", event), true);
  state.completeExecution("execution");
  assert.equal(state.beginExecution("rule", "execution", event), false);
});

test("failed rules are reported separately and do not prevent later rules", async t => {
  const { RulesEngine } = await import("../src/rules/rulesEngine");
  const { RelayOpsOrchestrator } = await import("../src/core/orchestrator");
  const state = new SqliteStateStore(path.join(temporary(t), "failures.db"));
  state.initialize();
  t.after(() => state.close());
  const rules = { targets: {}, rules: [
    { id: "fail", trigger: "manual", actions: [{ type: "post_message", target: "self", template: "" }] },
    { id: "continue", trigger: "manual", actions: [{ type: "clear_alerts" }] }
  ] };
  const engine = new RulesEngine({ config: { appName: "test" }, rules, state, logger, adapters: { alerts: { clearAll: async () => {} } } } as any);
  const orchestrator = new RelayOpsOrchestrator({ state, rulesEngine: engine, logger, actionLock: new ActionLock(), messaging: {}, pullRequests: {} } as any);
  const result = await orchestrator.runTrigger("manual");
  assert.equal(result.rulesFailed, 1);
  assert.equal(result.rulesExecuted, 1);
  assert.equal(result.rulesSkipped, 0);
});

test("Bitbucket rejects expired credentials rather than reporting no PRs", async t => {
  const { BitbucketPullRequestAdapter } = await import("../src/adapters/bitbucket/bitbucketPullRequestAdapter");
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = (async () => new Response("", { status: 401 })) as typeof fetch;
  const adapter = new BitbucketPullRequestAdapter({ workspace: "test", username: "test@example.com", appPassword: "dummy", repositorySlugs: ["test"] }, 3, logger);
  await assert.rejects(adapter.readOpenPullRequests(), /account email.*API token/);
});
