# RelayOps

RelayOps is a public-first, local-first automation platform for browser-driven workflows. It ships with a Playwright-based Microsoft Teams Web adapter, a config-driven rules engine, SQLite-backed state, a CLI, a local API, and a lightweight local web admin GUI built with React and Vite.

## Principles

- No credentials, tenants, URLs, names, or session data are hardcoded.
- Framework code stays generic; user behavior lives in config and environment variables.
- Runtime data is local-only and gitignored.
- Adapters are pluggable and implementation-agnostic.
- Teams browser actions use resilient selector chains, retries, and failure screenshots.
- Rule execution is guarded by execution keys, cooldowns, and persisted decision history.

## Quick Start

1. Install dependencies:

```bash
npm install
npx playwright install chromium
```

2. Create local config files:

```bash
cp .env.example .env
cp rules.example.yaml rules.local.yaml
```

3. Update `rules.local.yaml` and `.env` with your own targets and local paths.

4. Start RelayOps:

```bash
npm run dev
```

The service starts a local Express API at `http://127.0.0.1:4317`.
On first run, scheduler and startup Teams validation are disabled by default so you can finish setup in the GUI before enabling automation.

5. Start the admin GUI in development mode:

```bash
npm run ui:dev
```

The Vite frontend runs at `http://127.0.0.1:5173` and talks only to the local RelayOps API.

6. Or run both together:

```bash
npm run dev:all
```

After `npm run build`, the backend also serves the built admin UI from `/`.

## Admin GUI

The local admin panel includes:

- `Dashboard`: runtime health, Teams session state, recent activity, and last run summaries
- `Setup`: editable local config values backed by `.env`
- `Alerts`: active, acknowledged, and cleared alerts with acknowledge and clear operations
- `Manual Actions`: trigger runs, Teams session actions, test posts, and config validation
- `Logs`: runtime logs and rule execution history
- `Targets`: named target CRUD backed by the rules file
- `Rules`: structured rule editing backed by the rules file

## CLI

```bash
npm run cli -- start
npm run cli -- run-trigger new_pr
npm run cli -- run-trigger unread_message
npm run cli -- alerts-clear
npm run cli -- alerts-ack --key <dedupe-key>
npm run cli -- state
npm run cli -- teams-validate --wait
npm run cli -- teams-send --target review_channel --text "RelayOps test"
```

## Local API

The GUI uses the local API only. Key admin endpoints include:

- `GET /api/status`
- `GET /api/config`
- `PUT /api/config`
- `GET /api/rules-config`
- `PUT /api/targets`
- `PUT /api/rules`
- `GET /api/alerts`
- `POST /api/alerts/ack-all`
- `POST /api/alerts/clear`
- `GET /api/logs`
- `POST /api/actions/run-trigger`
- `POST /api/actions/teams/open`
- `POST /api/actions/teams/test-post`
- `POST /api/validate/config`

## Repository Layout

```text
relayops/
  src/
    core/
    adapters/
      browser/
      teams/
      notifications/
      git/
      ai/
    rules/
    state/
    server/
    cli/
    shared/
  web/
    src/
  examples/
  docs/
  plugins/
```

## Teams Web Notes

- RelayOps uses a persistent Playwright browser profile. Set `RELAYOPS_BROWSER_PROFILE_DIR` to a local-only path.
- Startup session validation is disabled by default for first-run usability. If you enable it and Teams Web is logged out, RelayOps keeps the local API/UI available and logs the startup validation failure instead of crashing.
- The first run may require you to sign into Teams Web in the persistent browser window.
- Prefer configuring Teams targets with a stable human-readable `label`. RelayOps now navigates by label first and treats a copied Teams link only as an optional fallback hint if label-based navigation does not resolve the target.
- RelayOps normalizes Teams launcher URLs and attempts to auto-select `Use the web app instead` so copied links do not bounce automation into the desktop-app launcher flow.
- Selectors are centralized in the Teams adapter for easier updates as Microsoft changes the UI.
- Session validation now logs the current Teams URL and page title when it cannot determine whether the profile is ready or logged out.
- UI actions use named fallback selector chains, interactability checks, retries, and screenshots on failure.

## Rules Guardrails

- `dedupeKey` gives each rule its own idempotency scope.
- `cooldownMinutes` suppresses repeat execution even when new events continue to match.
- Every rule decision is logged and persisted to SQLite execution history.
- Alert acknowledgment and execution-key tracking are persisted in SQLite for traceability.

## Extension Points

- Add new messaging backends by implementing `MessagingAdapter`.
- Replace the mock PR source by implementing `PullRequestAdapter`.
- Add richer summarization by implementing `SummaryAdapter`.
- Add more actions and conditions in the rules engine without changing caller code.
- Extend the local admin GUI by adding pages that consume the same `/api` contract.

## Documentation

- [Architecture](docs/architecture.md)
