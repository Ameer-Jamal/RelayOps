# Security

RelayOps controls an authenticated Teams session and can send messages as its signed-in user. Run it only on a trusted local computer. Keep the admin server bound to `127.0.0.1`; it is not an authenticated multi-user web service. Only connect the MCP server to AI clients you trust, and authorize the intended recipients in your task instructions.

Runtime tokens, browser profiles, message state, and screenshots live under `.relayops/`. Tokens and directory metadata use owner-only files. `.env`, `rules.local.yaml`, and runtime state are excluded from Git and release archives. Do not post these files, token-bearing URLs, or raw browser network exports in issues. Redact private recipients and message contents from screenshots.

The Teams integration uses internal Teams Web session APIs and can be affected by Microsoft changes or organizational policies. It does not bypass tenant permissions. Expired sessions require reauthentication. HTTP 401, 403, and 429 are reported separately. Uncertain sends are not automatically repeated through the API.

Supported security fixes target the latest GitHub release. Report vulnerabilities privately through [GitHub security advisories](https://github.com/Ameer-Jamal/RelayOps/security/advisories/new); do not disclose credentials in a public issue. If private reporting is unavailable, contact the maintainer through the GitHub profile without including sensitive details until a private channel is established.
