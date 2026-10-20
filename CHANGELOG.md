# Changelog

## 0.2.0 — 2026-10-20

### Added

- Teams MCP server with messaging, reading, discovery, status, authentication, and trigger tools.
- Automatic account/profile-specific Teams directory with paginated discovery, participant names, qualified channel names, and a 15-minute metadata cache.
- Searchable destination dropdown in Targets and Manual Actions, with server-side name/email/ID search, type filters, 30-result pages, keyboard navigation, and bounded rendering.
- Isolated recipient-safety/MCP tests and browser tests using 2,500 synthetic destinations.
- GitHub CI for Linux/macOS, tagged releases, a compiled runtime archive with checksums, and contributor/security documentation.

### Fixed

- Modern Teams Web proxy/bearer authentication capture alongside legacy regional Skype-token endpoints.
- Live Chromium profile locks are preserved; only confirmed stale local locks are removed.
- Ambiguous names require an exact destination; bot/departed-member chats are not mistaken for self-chat.
- Token/cache permissions, account isolation, same-origin pagination, read pacing, and throttling handling.
- MCP stdout remains reserved for JSON-RPC; rule guards apply by default and failed rules are reported separately.
- Bitbucket authentication failures no longer appear as empty PR lists; setup now explains API tokens.
- Dependency advisories resolved and Node 22 runtime requirements documented.

### Limitations

- Teams discovery uses internal Teams Web APIs, not a registered Microsoft Graph application. These APIs and tenant policies can change.
- Discovery covers the signed-in user's conversation index, not an organization-wide directory. Missing or ambiguous destinations require a conversation ID.
- Scheduled local tasks require the computer/client to remain available and Teams to remain authenticated.
- Bitbucket PR scans require a current API token and the matching Atlassian account email; legacy app passwords are rejected.
- Live validation confirmed self-chat delivery and read/discovery API access. Channel/person sends were not exercised against other recipients.

## 0.1.0

Initial local rules engine, SQLite execution state, browser-driven Teams adapter, CLI, admin UI, and Bitbucket integration. No packaged GitHub release was published for this version.
