# Pi + Stagehand over MCP/stdio

This example uses Pi 1.4.0's built-in MCP support to mount Stagehand's `run`,
`snapshot`, and `screenshot` tools. The project `.pi/mcp.json` sets `exposure` to
`direct`, so Pi declares the tools as `mcp__stagehand__*` rather than requiring
Pi's default codemode scripts.

## Setup

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
export OPENAI_API_KEY="your-openai-api-key" # or ANTHROPIC_API_KEY
```

The server uses local Chrome by default, or Browserbase when
`BROWSERBASE_API_KEY` is set. To select Browserbase explicitly:

```bash
export STAGEHAND_BROWSER=browserbase
export BROWSERBASE_API_KEY="your-browserbase-api-key"
```

## Run

Start from this directory so Pi discovers the project MCP file and resolves the
server path relative to the package:

```bash
cd packages/integrations/pi
pnpm start "Open https://example.com and report the page title." </dev/null
```

The script runs `pi --approve --no-session -p`. `--approve` loads trusted project
files without an interactive prompt. `</dev/null` prevents print mode from
waiting for piped input. Run `pnpm exec pi --approve` for an interactive session.

To mount the server for other projects:

```bash
pi mcp add stagehand --exposure direct --description "Persistent Stagehand browser tools" -- \
  node /absolute/path/to/stagehand/packages/integrations/core/dist/facade/stdio-server.mjs
```

Remove any previously installed native Stagehand extension before enabling this
MCP mount. The old `pi install` setup is no longer used.

## Browser lifecycle

One MCP child owns the browser for the session. Keep it connected across tool
calls to preserve navigation, authentication, and page state. The shared facade
provides tool descriptions and validation; this CLI mount does not append its
agent instructions to Pi's system prompt.

The child inherits the shell environment, including Pi's model credentials.
Only `STAGEHAND_*` and `BROWSERBASE_*` settings configure the browser tools;
the tools are deterministic and do not need Pi's model credentials.

The `run` tool executes model-authored JavaScript in the browser extension's
service worker. Use Browserbase for untrusted tasks and review the
[integration security boundary](https://docs.stagehand.dev/v4/integrations/cli-agents/overview#security-boundary).
