# Architecture

## Components

- Core orchestrator: collects trigger events, evaluates rules, executes actions.
- Rules engine: interprets config-driven conditions and actions, applies rule-level cooldowns, and records decision reasons.
- State store: SQLite-backed idempotency, execution keys, alert acknowledgment, cooldown, and observation tracking.
- Adapters: Teams messaging, browser automation, alerts, PR source, summarization.
- CLI and API: manual trigger execution, state inspection, config persistence, and operational controls.
- Local web admin GUI: React + Vite frontend that reads and writes only through the local API.

## Event Flow

1. A scheduler or manual command runs a trigger such as `new_pr` or `unread_message`.
2. The orchestrator asks the relevant adapter for current events.
3. Each event is observed in SQLite to establish first-seen timestamps.
4. Matching rules are evaluated against event data and stored state, including execution-key dedupe and cooldown checks.
5. Actions run through generic interfaces such as messaging and alerting.
6. Every rule decision is written to execution history, and successful executions mark the event as processed for that rule.

## Public-Safe Boundaries

- Config files define targets, timing, and workflows.
- Environment variables define runtime paths and operational settings.
- Browser profile data, SQLite files, screenshots, and session state stay outside git.
- Teams selectors contain only generic UI assumptions, not tenant-specific data.
- Session validation fails fast by default so browser automation does not continue on a logged-out profile.
- The admin GUI is a convenience layer; config files and SQLite remain the source of truth.
