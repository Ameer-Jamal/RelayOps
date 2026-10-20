import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TeamsDirectoryEntry, TeamsDirectoryOptions, TeamsDirectoryView } from "../../shared/adminApi";
import { TeamsApiError, TeamsChatService, type TeamsTokenBundle } from "./teamsChatService";

interface Cache {
  version: 2;
  accountId: string;
  profileId: string;
  updatedAt: string;
  complete: boolean;
  warnings: string[];
  entries: TeamsDirectoryEntry[];
}
const MAX_AGE_MS = 15 * 60_000;

export class TeamsDirectory {
  private refreshing?: Promise<void>;
  private lastError?: { accountId: string; state: TeamsDirectoryView["api"]["state"]; message: string };

  constructor(private readonly stateDir: string, private readonly api: TeamsChatService) {}

  private accountKey(token: TeamsTokenBundle): string {
    return token.accountId ?? crypto.createHash("sha256").update(token.chatServiceToken ?? token.skypeToken).digest("hex");
  }

  private file(token: TeamsTokenBundle): string {
    const key = crypto.createHash("sha256").update(this.api.profileId + this.accountKey(token)).digest("hex");
    return path.join(this.stateDir, `teams-directory-${key}.json`);
  }

  private load(): Cache | undefined {
    const token = this.api.getToken();
    if (!token) return undefined;
    try {
      const data = JSON.parse(fs.readFileSync(this.file(token), "utf8")) as Cache;
      if (data.version !== 2 || data.accountId !== this.accountKey(token) || data.profileId !== this.api.profileId || !Array.isArray(data.entries)) return undefined;
      data.entries = data.entries.map((entry) => {
        const displayName = entry.displayName.trim();
        const teamName = entry.teamName?.trim();
        return { ...entry, displayName, teamName, aliases: entry.kind === "channel" && teamName ? [`${teamName} / ${displayName}`] : entry.aliases };
      });
      return data;
    } catch { return undefined; }
  }

  view(options: TeamsDirectoryOptions = {}): TeamsDirectoryView {
    const token = this.api.getToken();
    const cache = this.load();
    const query = options.query?.trim().toLowerCase() ?? "";
    const matches = (cache?.entries ?? []).filter((entry) => {
      const kindMatches = !options.kind || options.kind === "all" ||
        (options.kind === "person" ? entry.chatType === "oneOnOne" :
          options.kind === "chat" ? entry.kind === "chat" && entry.chatType !== "oneOnOne" : entry.kind === "channel");
      return kindMatches && (!query || [entry.displayName, entry.teamName, entry.id, ...entry.memberNames, ...entry.memberEmails, ...entry.aliases].some((name) => name?.toLowerCase().includes(query)));
    });
    const limit = Number.isFinite(options.limit) ? Math.max(1, Math.min(100, Math.floor(options.limit!))) : 50;
    const offset = Number.isFinite(options.offset) ? Math.max(0, Math.floor(options.offset!)) : 0;
    const lastError = token && this.lastError?.accountId === this.accountKey(token) ? this.lastError : undefined;
    return {
      accountEmail: token?.accountEmail,
      updatedAt: cache?.updatedAt ?? null,
      stale: !cache || !this.api.hasValidToken() || Date.now() - Date.parse(cache.updatedAt) >= MAX_AGE_MS || Boolean(lastError),
      complete: cache?.complete ?? false,
      total: cache?.entries.length ?? 0,
      matched: matches.length,
      offset,
      nextOffset: offset + limit < matches.length ? offset + limit : null,
      entries: matches.slice(offset, offset + limit),
      api: {
        state: lastError?.state ?? (cache && this.api.hasValidToken() ? "ready" : this.api.hasValidToken() ? "not_connected" : "auth_required"),
        endpoint: token ? this.api.apiBase(token) : undefined,
        message: lastError?.message ?? (!cache ? "Refresh to test API access and discover your Teams destinations." : undefined)
      },
      warnings: cache?.warnings ?? []
    };
  }

  async refresh(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.refreshUnlocked().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private async refreshUnlocked(): Promise<void> {
    const token = this.api.getToken();
    if (!token || !this.api.hasValidToken()) throw new TeamsApiError(401);
    const accountId = this.accountKey(token);
    try {
      const { conversations, complete } = await this.api.fetchAllConversations(token);
      const warnings: string[] = [];
      if (!complete) warnings.push("The API pagination limit was reached. This directory may be incomplete.");
      const teamNames = new Map(conversations.filter((c) => c.threadType === "space").map((c) => [c.id, c.topic]));
      const rows = conversations.filter((c) => ["chat", "meeting", "topic", "streamofnotes"].includes(c.threadType));
      const members = new Map<string, string[]>();
      const untitled = rows.filter((c) => c.threadType === "chat" && !c.topic);
      // Limit roster fan-out; unresolved entries remain visible by ID and cannot match a person by guesswork.
      let next = 0;
      let rosterFailures = 0;
      let rosterFatal: unknown;
      await Promise.all(Array.from({ length: Math.min(6, untitled.length) }, async () => {
        while (!rosterFatal && next < Math.min(500, untitled.length)) {
          const row = untitled[next++]!;
          try { members.set(row.id, await this.api.fetchMemberIds(row.id, token)); }
          catch (error) {
            if (error instanceof TeamsApiError && [401, 429].includes(error.status)) { rosterFatal = error; break; }
            rosterFailures++;
          }
        }
      }));
      if (rosterFatal) throw rosterFatal;
      if (untitled.length > 500 || rosterFailures) warnings.push("Some participant lists could not be resolved; those chats are listed by ID.");
      const ids = [...new Set([...members.values()].flat().filter((id) => id.startsWith("8:")))];
      const profiles = new Map<string, { displayName: string; email: string }>();
      for (let start = 0; start < ids.length; start += 50) {
        try {
          for (const profile of await this.api.fetchProfiles(ids.slice(start, start + 50), token)) profiles.set(profile.id, profile);
        } catch (error) {
          warnings.push(error instanceof Error ? error.message : "Participant name lookup failed.");
          break;
        }
      }
      const entries: TeamsDirectoryEntry[] = rows.map((c) => {
        const participants = members.get(c.id) ?? [];
        const others = participants.filter((id) => id !== `8:orgid:${token.userId}`);
        const self = c.id === "48:notes" || c.threadType === "streamofnotes";
        const bot = others.some((id) => id.startsWith("28:"));
        const people = others.map((id) => profiles.get(id)).filter((person) => person !== undefined);
        const memberNames = people.map((person) => person.displayName).filter(Boolean);
        const memberEmails = people.map((person) => person.email).filter(Boolean);
        const kind = c.threadType === "topic" ? "channel" as const : "chat" as const;
        const teamName = c.spaceId ? teamNames.get(c.spaceId) : undefined;
        const displayName = self ? "Myself" : c.topic || memberNames.join(", ") || `${bot ? "Bot chat" : "Unnamed chat"} (${c.id})`;
        const chatType = kind === "channel" ? undefined : self ? "self" as const : c.threadType === "meeting" ? "meeting" as const : bot ? "bot" as const : participants.length === 2 ? "oneOnOne" as const : "group" as const;
        return {
          id: c.id, displayName, kind, chatType, teamName, memberNames, memberEmails,
          // Individual participant names are only safe aliases for a one-to-one chat.
          aliases: self ? ["me", "myself", "notes"] : kind === "channel" && teamName ? [`${teamName} / ${displayName}`] : chatType === "oneOnOne" ? [...memberNames, ...memberEmails] : [],
          url: `https://teams.cloud.microsoft/l/${kind === "channel" ? "channel" : "chat"}/${encodeURIComponent(c.id)}${kind === "chat" ? "/conversations" : ""}`
        };
      }).sort((a, b) => a.displayName.localeCompare(b.displayName));
      if (this.api.getToken()?.accountId !== token.accountId) throw new Error("Teams account changed during discovery. Refresh again.");
      const cache: Cache = { version: 2, accountId, profileId: this.api.profileId, updatedAt: new Date().toISOString(), complete: complete && warnings.length === 0, warnings: [...new Set(warnings)], entries };
      fs.mkdirSync(this.stateDir, { recursive: true });
      const temporary = this.file(token) + `.${crypto.randomUUID()}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(cache), { mode: 0o600 });
      fs.renameSync(temporary, this.file(token));
      this.lastError = undefined;
    } catch (error) {
      this.lastError = { accountId, state: error instanceof TeamsApiError ? error.code : "api_error", message: error instanceof Error ? error.message : String(error) };
      throw error;
    }
  }

  resolve(name: string): TeamsDirectoryEntry | undefined {
    const query = name.trim().toLowerCase();
    const cache = this.load();
    const direct = cache?.entries.find((entry) => entry.id === name);
    if (direct) return direct;
    if (cache && !cache.complete) throw new Error("Teams discovery is incomplete. Search the directory and use a conversation ID for exact delivery.");
    const matches = (cache?.entries ?? []).filter((entry) => entry.id === name || [entry.displayName, ...entry.aliases].some((alias) => alias.toLowerCase() === query));
    if (matches.length > 1) throw new Error(`Multiple Teams destinations match "${name}". Search the directory and use a conversation ID or a team/channel name.`);
    return matches[0];
  }
}
