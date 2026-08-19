# Codex SDK + Stagehand facade over MCP/stdio

A runnable example embedding a Codex agent via `@openai/codex-sdk`, with the Stagehand facade
(`run` / `snapshot` / `screenshot`) mounted as a stdio MCP server through the SDK's config
override — install, export keys, one line to run. The SDK spawns the bundled Codex runtime;
MCP servers are supplied config.toml-style because codex-sdk has no in-process MCP mounting
(the same mechanism the evals codex harness uses).

## Setup

Use Node.js 24 or later. From the repository root, build the integrations package first:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Export credentials (Browserbase is the default and recommended backend). Codex auth comes from
`OPENAI_API_KEY` or an existing `codex login`:

```bash
export OPENAI_API_KEY=sk-...
export BROWSERBASE_API_KEY=bb_live_...
export BROWSERBASE_PROJECT_ID=...   # optional
```

## Run

```bash
pnpm --filter @browserbasehq/stagehand-integrations-example-codex-facade start "Open https://example.com, snapshot it, and report the heading citing the snapshot ID."
```

| Variable                 | Purpose                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGEHAND_BROWSER`      | Browser backend. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`.                                                              |
| `BROWSERBASE_API_KEY`    | Browserbase credential for the browser session.                                                                                                               |
| `BROWSERBASE_PROJECT_ID` | Optional Browserbase project ID.                                                                                                                              |
| `CODEX_STAGEHAND_MODEL`  | Optional model override; by default Codex uses its own harness-tuned model.                                                                                   |
| `OPENAI_API_KEY`         | Codex SDK credential (never forwarded to the browser).                                                                                                        |
| `CODEX_PATH_OVERRIDE`    | Path to a locally installed `codex` binary if your package manager skips the SDK's vendored-binary postinstall (`export CODEX_PATH_OVERRIDE=$(which codex)`). |

The local sandbox stays `read-only` — all browser work happens inside the MCP server. Note
Codex has no native turn limit; long tasks run until the model finishes.

## Connecting a running Codex CLI instead

To use the facade from the interactive `codex` CLI rather than the SDK, merge the
`config.toml` in this directory into `~/.codex/config.toml` (Codex does not expand shell
variables in config values), or pass everything per-invocation:

```bash
codex exec \
  -c mcp_servers.stagehand.command=node \
  -c 'mcp_servers.stagehand.args=["/absolute/path/to/packages/integrations/core/dist/facade/stdio-server.mjs"]' \
  -c 'mcp_servers.stagehand.env={ STAGEHAND_BROWSER = "browserbase", BROWSERBASE_API_KEY = "bb_live_..." }' \
  "your instruction"
```

Note: the SDK's config overrides _merge_ with any `[mcp_servers]` already in your
`~/.codex/config.toml` rather than replacing them; set `CODEX_HOME` to a scratch directory if
you need isolation.

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's
service worker — browser-side, never on your machine. Browserbase is the recommended isolation
boundary: the privileged execution environment is a disposable cloud browser. The SDK example
spawns the facade server with an explicit `STAGEHAND_*`/`BROWSERBASE_*` allowlist; Codex's own
model credentials never reach the browser session.
