# Codex CLI + Stagehand facade over MCP/stdio

The Codex CLI consumes the Stagehand facade as a standard MCP server — no integration code,
just an `[mcp_servers]` entry in Codex's TOML config. `config.toml` in this directory is the
template.

## Setup

Use Node.js 24 or later. From the repository root, build the integrations package first:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Merge the `config.toml` block from this directory into `~/.codex/config.toml`, filling in the
absolute path to your checkout and your Browserbase credentials (Codex does not expand shell
variables in config values).

## Run

Interactive:

```bash
codex
```

Headless one-shot:

```bash
codex exec "Use the stagehand browser tools: open https://example.com, snapshot it, and report the heading citing the snapshot ID."
```

Per-invocation alternative (no global config edit; useful for CI):

```bash
codex exec \
  -c mcp_servers.stagehand.command=node \
  -c 'mcp_servers.stagehand.args=["/absolute/path/to/packages/integrations/core/dist/facade/stdio-server.mjs"]' \
  -c 'mcp_servers.stagehand.env={ STAGEHAND_BROWSER = "browserbase", BROWSERBASE_API_KEY = "bb_live_..." }' \
  "your instruction"
```

The three tools surface under the `stagehand` server namespace (`run`, `snapshot`,
`screenshot`); their descriptions carry the usage contract, so no extra instructions are
required.

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's
service worker — browser-side, never on your machine. Browserbase is the recommended isolation
boundary: the privileged execution environment is a disposable cloud browser. The config
forwards only the `STAGEHAND_*`/`BROWSERBASE_*` variables it names; Codex's own model
credentials never reach the browser session.
