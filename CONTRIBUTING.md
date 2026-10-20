# Contributing

Use Node 22.22.2 or newer in the Node 22 release line. From a clean checkout:

```sh
npm ci
npx playwright install chromium
npm run verify
```

`verify` runs strict backend/frontend typechecks, isolated unit/MCP tests, a production build, and Chromium UI tests. The UI tests use temporary state and 2,500 synthetic destinations on port 4328. They must never use a real Teams account or send live messages. GitHub Actions runs the core checks on Linux and macOS and UI tests on Linux.

Keep changes focused and describe the visible behavior, verification, and limitations in the pull request. Add tests for recipient ambiguity, credentials, cache isolation, pagination, and message-delivery changes. Check keyboard interaction and empty/error states for picker changes. Preserve existing user edits and keep credentials and runtime data out of patches.

## Releases

Update the versions in both package files and the lockfile, document the change in `CHANGELOG.md`, then run `npm run verify` and `npm run release:package`. Commit the version update before creating `vX.Y.Z`; tags must match package versions. Pushing a version tag runs CI again, builds a runtime archive, and publishes a GitHub release with SHA-256 checksums. Releases do not publish to npm. The runtime archive contains compiled server/UI code and public setup examples; it excludes dependencies, credentials, and browser state. Users install platform-specific native dependencies with `npm ci --omit=dev` on their own machine.
