# pi + Stagehand facade over MCP/stdio

[Pi](https://pi.dev) 1.0 includes built-in MCP. This package mounts the Stagehand
facade (`run`, `snapshot`, `screenshot`) as a project stdio server in
`.pi/mcp.json`, the same pattern as the Claude Code and Codex CLI examples.

Pi's default MCP exposure is `codemode` (tools are only callable from Pi's
`codemode` scripts). The project file sets `"exposure": "direct"` so the model
calls `mcp__stagehand__run` like a built-in tool.

## Setup

Use Node.js 24 or later. From the repository root, build the integrations package first:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Export the browser credentials (Browserbase is the default and recommended backend) and a model
key pi supports:

```bash
export BROWSERBASE_API_KEY=bb_live_...
export OPENAI_API_KEY=sk-...   # or ANTHROPIC_API_KEY
```

## Run

Start Pi from this directory so the relative facade path in `.pi/mcp.json` resolves. Print
mode never shows the project-trust prompt, so `--approve` (`-a`) is required for the project
MCP file to load:

```bash
cd packages/integrations/pi
pi --approve --no-session -p "Use your browser tools: open https://example.com, snapshot it, and report the heading citing the snapshot ID." </dev/null
```

Two headless gotchas: print mode reads piped stdin (always redirect `</dev/null`), and
non-interactive runs never show the project-trust prompt — use `-a` as above.

Pi inherits the shell environment for the MCP child, so the exports above are the only
configuration. The MCP child owns one browser for the session; do not restart the server
per tool call.

## User-level install

To register the same server for every Pi session instead of this project:

```bash
pi mcp add stagehand --exposure direct --description "Persistent Stagehand browser tools" -- \
  node /absolute/path/to/stagehand/packages/integrations/core/dist/facade/stdio-server.mjs
```

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's
service worker — browser-side, never in the pi process. Browserbase is the recommended
isolation boundary: the privileged execution environment is a disposable cloud browser. Only
`STAGEHAND_*`/`BROWSERBASE_*` variables configure the MCP child, and pi's model credentials
never reach the browser session.
