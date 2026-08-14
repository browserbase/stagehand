# Claude Code + Stagehand facade over MCP/stdio

Claude Code consumes the Stagehand facade as a standard MCP server — no integration code at
all, just the project-scoped `.mcp.json` in this directory.

## Setup

Use Node.js 24 or later. From the repository root, build the integrations package first:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Export the browser credentials (Browserbase is the default and recommended backend):

```bash
export BROWSERBASE_API_KEY=bb_live_...
export BROWSERBASE_PROJECT_ID=...
```

## Run

Start Claude Code from this directory so it picks up `.mcp.json`. The server process inherits
your shell environment, so the exports above are all the configuration needed:

```bash
cd packages/integrations/claude-code
claude
```

Approve the `stagehand` MCP server when prompted, then ask for browser work, for example:

> Use your browser tools: open https://example.com, snapshot it, and report the page heading
> citing the snapshot ID.

Headless one-shot form:

```bash
claude -p "Use your browser tools: open https://example.com, snapshot it, and report the heading citing the snapshot ID." --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

The three tools appear as `mcp__stagehand__run`, `mcp__stagehand__snapshot`, and
`mcp__stagehand__screenshot`; their descriptions carry the usage contract, so no extra system
prompt is required.

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's
service worker — browser-side, never on your machine. Browserbase is the recommended isolation
boundary: the privileged execution environment is a disposable cloud browser. Note that Claude
Code spawns stdio servers with your full shell environment; the facade only reads
`STAGEHAND_*`/`BROWSERBASE_*` variables, and nothing from the host environment is forwarded
into the browser session itself.
