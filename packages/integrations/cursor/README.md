# Cursor agent CLI + Stagehand facade over MCP/stdio

Cursor's `agent` CLI consumes the Stagehand facade (`run` / `snapshot` / `screenshot`) as a
project MCP server through `.cursor/mcp.json`.

<!-- Verified against cursor.com/docs/cli as of 2026-08; the `agent` binary was not available to run locally, so flags are from the published reference. -->

## Setup

Use Node.js 24 or newer. From the repository root, build the integrations package first:

```bash
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Install the Cursor agent CLI, then authenticate with an existing login or an API key:

```bash
curl https://cursor.com/install -fsS | bash
agent login
# or: export CURSOR_API_KEY=...
```

## Configure

Copy `mcp.json` from this directory to `<project>/.cursor/mcp.json`, or merge its `mcpServers`
entry into `~/.cursor/mcp.json`. Fill in the absolute path to your checkout and replace the
`BROWSERBASE_API_KEY` placeholder with your key.

Verify that Cursor can load the mount:

```bash
agent mcp list-tools stagehand
```

## Run

Run from this directory so Cursor reads the `AGENTS.md` browser-tool guidance at the workspace
root:

```bash
agent -p --force --approve-mcps --trust --output-format stream-json "Use the stagehand MCP tools: open https://example.com, snapshot it, and report the heading citing the snapshot ID."
```

Cursor's CLI does not emit token usage in any output format.
