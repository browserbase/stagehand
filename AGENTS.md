# AGENTS.md

## Cursor Cloud specific instructions

Stagehand is a pnpm + Turborepo monorepo (the AI browser-automation framework). Standard commands live in the root `package.json` scripts, `turbo.json`, and per-package `package.json` files; prefer those over duplicating here.

### Services / packages

- `packages/core` (`@browserbasehq/stagehand`) — the primary library/SDK.
- `packages/server-v3` — Fastify REST API wrapping Stagehand. Dev: `pnpm --filter @browserbasehq/stagehand-server-v3 dev` (listens on `PORT`, default `3000`; health at `/healthz`, `/readyz`). Auth is currently disabled server-side, so requests need no auth token.
- `packages/cli` (`browse`) — oclif CLI.
- `packages/evals`, `packages/docs` — evals suite and Mintlify docs.
- Note: `pnpm-workspace.yaml` references `packages/server-v4`, which does not exist on disk; the resulting pnpm warning is harmless.

### Browser (local automation)

- LOCAL mode launches the system Chrome via `chrome-launcher` (`google-chrome` is preinstalled); no Playwright browser download is needed.
- In this container Chrome needs `--no-sandbox`. Pass it through `localBrowserLaunchOptions.args` (core) or `browser.launchOptions.args` (server API). Use `headless: true` for non-GUI runs (default is headed).

### API keys (required for AI features + most tests)

- No LLM keys are set by default. The AI methods (`act`/`extract`/`observe`/`agent`) and the test suites `test:core`, `test:e2e`, `test:evals`, and server `test:integration` require at least one provider key (e.g. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`) set in the environment or `.env`.
- Pure browser control works without a key: `page.goto`, `title()`, `screenshot()`, and the server `navigate` endpoint. A local session can start without a key (server treats the model API key as optional).
- Browserbase-targeted variants (`test:*:bb`, `STAGEHAND_SERVER_TARGET=remote`) need `BROWSERBASE_API_KEY`.

### Lint / test caveats

- `pnpm lint` currently fails only on a pre-existing Prettier formatting issue in `packages/cli/src/lib/cloud/reduce-logs.ts` (unrelated to any change). The lint tooling itself works.
- Key-free automated tests: `pnpm --filter browse run test:cli` (vitest) and `pnpm --filter @browserbasehq/stagehand-server-v3 run test:unit`. The server unit run passes all tests but the optional CTRF report step (`junit-to-ctrf`) errors on a `minimatch`/`glob` ESM mismatch — this is post-test reporting only and does not affect results.
