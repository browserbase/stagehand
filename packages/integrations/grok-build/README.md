# Grok Build CLI + Stagehand facade over MCP/stdio

Grok Build's `grok` CLI consumes the Stagehand facade (`run` / `snapshot` / `screenshot`) as a
project MCP server through `.grok/config.toml`.

Tested with Grok Build 1.0.77.

## Setup

Use Node.js 24 or newer and pnpm 11.11.0. From the repository root, build the integrations package first:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
npm install --global @xai-official/grok@1.0.77
grok login
# or: export XAI_API_KEY=...
```

## Configure

Replace the absolute facade path in `.grok/config.toml`. To use this example in
another project, copy `.grok/config.toml` and `AGENTS.md` there and run Grok from
that directory.

The template selects Browserbase. Export `BROWSERBASE_API_KEY` before starting Grok.
For local Chrome, replace the entire `[mcp_servers.stagehand.env]` block with:

```toml
[mcp_servers.stagehand.env]
STAGEHAND_BROWSER = "local"
```

## Run

Start `grok` in the configured project and approve project trust so it loads the
MCP configuration. Ask Grok to use Stagehand to open https://example.com, take a
snapshot, and report the heading with its snapshot ID.

For a headless run in the trusted project:

```bash
grok \
  --always-approve \
  --tools search_tool,use_tool \
  --disallowed-tools Agent \
  --no-plan \
  --no-subagents \
  --disable-web-search \
  -p "Use stagehand__run to open https://example.com, then stagehand__snapshot to report the heading and snapshot ID."
```

`--always-approve` lets Grok execute the enabled tools without asking. A headless
run cannot respond to approval prompts.
