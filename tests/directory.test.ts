import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { TeamsChatService, TeamsApiError } from "../src/adapters/teams/teamsChatService";
import { TeamsDirectory } from "../src/adapters/teams/teamsDirectory";
import { TeamsTokenCapture } from "../src/adapters/teams/tokenCapture";
import type { Logger } from "../src/types";
const logger: Logger = { debug() {}, info() {}, warn() {}, error() {} };
const base = "https://teams.cloud.microsoft/api/chatsvc/emea/v1";
const profileBase = "https://teams.cloud.microsoft/api/mt/part/emea-02/beta";
function setup(t: any) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "relayops-directory-"));
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; fs.rmSync(dir, { recursive: true, force: true }); });
  const api = new TeamsChatService(dir, logger);
  api.saveToken({ skypeToken: "", chatServiceToken: "dummy", apiBaseUrl: base, region: "emea", accountId: "account-one", userId: "self", profileApiBaseUrl: profileBase, profileToken: "profile-dummy" });
  return { dir, api, directory: new TeamsDirectory(dir, api) };
}
function respond(data: unknown, status = 200) { return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }); }
function installDirectoryMock() {
  const calls: string[] = [];
  globalThis.fetch = (async (input: any, options?: RequestInit) => {
    const url = String(input);
    calls.push(url);
    assert.ok(url.startsWith(base + "/") || url.startsWith(profileBase + "/"));
    if (url.endsWith("fetchShortProfile")) {
      assert.equal(options?.method, "POST");
      assert.ok(Array.isArray(JSON.parse(options?.body as string)));
      return respond({ value: [{ mri: "8:orgid:other", displayName: "Alex Smith", email: "alex@example.com" }] });
    }
    if (url.includes("/threads/")) return respond({ members: [{ id: "8:orgid:self" }, { id: "8:orgid:other" }] });
    if (url.includes("cursor=next")) return respond({ conversations: [
      { id: "19:team-a", threadProperties: { threadType: "space", spaceThreadTopic: "Team A" } },
      { id: "19:team-b", threadProperties: { threadType: "space", spaceThreadTopic: "Team B" } },
      { id: "19:channel-a", threadProperties: { threadType: "topic", topic: "General", spaceId: "19:team-a" } },
      { id: "19:channel-b", threadProperties: { threadType: "topic", topic: "General", spaceId: "19:team-b" } }
    ] });
    return respond({ conversations: [
      { id: "19:person", threadProperties: { threadType: "chat" }, lastMessage: { content: "SECRET-MESSAGE" } },
      { id: "19:group", threadProperties: { threadType: "chat", topic: "Project Room" } },
      { id: "48:mentions", threadProperties: { threadType: "streamofmentions" } }
    ], _metadata: { backwardLink: `${base}/users/ME/conversations?cursor=next` } });
  }) as typeof fetch;
  return calls;
}

test("directory follows pagination, resolves people, qualifies channels, and caches only metadata", async t => {
  const { dir, api, directory } = setup(t);
  const calls = installDirectoryMock();
  await directory.refresh();
  assert.equal(directory.view().total, 4);
  assert.equal(directory.view().complete, true);
  assert.equal(directory.view({ query: "alex@example.com" }).matched, 1);
  assert.equal(directory.resolve("Alex Smith")?.id, "19:person");
  assert.throws(() => directory.resolve("General"), /Multiple/);
  assert.equal(directory.resolve("Team A / General")?.id, "19:channel-a");
  assert.equal(directory.resolve("Alex"), undefined);
  assert.equal(directory.resolve("Project Room")?.id, "19:group");
  const before = calls.length;
  assert.equal(new TeamsDirectory(dir, api).view().total, 4);
  assert.equal(calls.length, before);
  const file = path.join(dir, fs.readdirSync(dir).find(name => name.startsWith("teams-directory-"))!);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.ok(!fs.readFileSync(file, "utf8").includes("SECRET-MESSAGE"));
  api.saveToken({ skypeToken: "", chatServiceToken: "other", accountId: "account-two", apiBaseUrl: base });
  assert.equal(directory.view().total, 0);
  assert.equal(directory.resolve("Alex Smith"), undefined);
});

test("API 403 retains same-account cache and is distinguished from expired authentication", async t => {
  const { directory } = setup(t);
  installDirectoryMock();
  await directory.refresh();
  globalThis.fetch = (async () => respond({}, 403)) as typeof fetch;
  await assert.rejects(directory.refresh(), (error: any) => error instanceof TeamsApiError && error.code === "permission_denied");
  assert.equal(directory.view().total, 4);
  assert.equal(directory.view().api.state, "permission_denied");
  assert.equal(directory.view().stale, true);
  globalThis.fetch = (async () => respond({}, 401)) as typeof fetch;
  await assert.rejects(directory.refresh(), (error: any) => error.code === "auth_required");
});

test("pagination cannot forward credentials to an unrelated host", async t => {
  const { api } = setup(t);
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return respond({ conversations: [{ id: "19:a" }], _metadata: { backwardLink: "https://other.example/collect" } }); }) as typeof fetch;
  await assert.rejects(api.fetchAllConversations(api.getToken()!), /outside/);
  assert.equal(calls, 1);
});

test("new Teams proxy bearer capture binds identity, region, and matching profile token", async t => {
  const { dir } = setup(t);
  const api = new TeamsChatService(path.join(dir, "fresh"), logger);
  const capture = new TeamsTokenCapture(api, logger);
  let listener: any;
  const page: any = { on: (_: string, handler: any) => { listener = handler; }, context: () => ({ cookies: async () => [], newCDPSession: async () => { throw new Error("unsupported"); } }) };
  await capture.attach(page);
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const jwt = (oid: string) => `header.${Buffer.from(JSON.stringify({ oid, tid: "tenant", exp: expires, upn: "self@example.com" })).toString("base64url")}.signature`;
  const request = (url: string, token: string) => ({ url: () => url, headers: () => ({ authorization: `Bearer ${token}` }) });
  listener(request(profileBase + "/users/tenantsv2", jwt("self")));
  listener(request(base + "/users/ME/conversations", jwt("self")));
  assert.equal(api.hasValidToken(), true);
  assert.equal(api.getToken()?.apiBaseUrl, base);
  assert.equal(api.getToken()?.region, "emea");
  assert.equal(api.getToken()?.profileToken, jwt("self"));
  assert.equal(api.getToken()?.accountEmail, "self@example.com");
  listener(request(base + "/users/ME/conversations", jwt("different")));
  assert.equal(api.getToken()?.profileToken, undefined);
  assert.equal(new TeamsChatService(path.join(dir, "fresh"), logger, "/another/profile").hasValidToken(), false);
});

test("a former participant or a bot cannot be mistaken for the self-chat", async t => {
  const { api, directory } = setup(t);
  api.fetchAllConversations = async () => ({ complete: true, conversations: [
    { id: "48:notes", topic: "", threadType: "streamofnotes" },
    { id: "19:departed", topic: "", threadType: "chat" },
    { id: "19:bot", topic: "", threadType: "chat" }
  ] });
  api.fetchMemberIds = async id => id === "19:bot" ? ["8:orgid:self", "28:bot-id"] : ["8:orgid:self"];
  api.fetchProfiles = async () => [];
  await directory.refresh();
  const selves = directory.view().entries.filter(entry => entry.chatType === "self");
  assert.deepEqual(selves.map(entry => entry.id), ["48:notes"]);
  assert.equal(directory.resolve("Myself")?.id, "48:notes");
  assert.equal(directory.view().entries.find(entry => entry.id === "19:bot")?.chatType, "bot");
});

test("large directories filter before pagination with bounded payloads", async t => {
  const { api, directory } = setup(t);
  api.fetchAllConversations = async () => ({ complete: true, conversations: [
    { id: "19:team", topic: "Team", threadType: "space" },
    ...Array.from({ length: 2500 }, (_, i) => ({ id: `19:${i}`, topic: `Destination ${String(i).padStart(4, "0")}`, threadType: i % 5 === 0 ? "topic" : "chat", spaceId: "19:team" }))
  ] });
  await directory.refresh();
  const first = directory.view({ limit: 30 });
  assert.equal(first.total, 2500);
  assert.equal(first.entries.length, 30);
  assert.equal(first.nextOffset, 30);
  const next = directory.view({ limit: 30, offset: first.nextOffset! });
  assert.ok(!first.entries.some(entry => next.entries.some(other => other.id === entry.id)));
  assert.equal(directory.view({ kind: "channel" }).matched, 500);
  assert.equal(directory.view({ kind: "person" }).matched, 0);
  const exact = directory.view({ query: "2499" });
  assert.equal(exact.entries[0]?.id, "19:2499");
  assert.equal(exact.nextOffset, null);
  assert.equal(directory.view({ limit: 5000 }).entries.length, 100);
});
