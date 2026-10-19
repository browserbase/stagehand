# Grok Build CLI + Stagehand facade over MCP/stdio

Grok Build's `grok` CLI consumes the Stagehand facade (`run` / `snapshot` / `screenshot`) as a
project MCP server through `.grok/config.toml`.

Tested with Grok Build 1.0.52.

## Setup

Use Node.js 24 or newer. From the repository root, build the integrations package first:

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
npm install --global @xai-official/grok
grok login
# or: export XAI_API_KEY=...
```

## Configure

Copy `.grok/config.toml` and `AGENTS.md` from this directory to your project, then replace the facade path and
export `BROWSERBASE_API_KEY`. Grok expands `${BROWSERBASE_API_KEY}` from the environment and
loads project MCP configuration after you trust the project. Start an interactive `grok` session
once to approve project trust before using the headless command below.

## Run

Run from the configured project so Grok sees both `.grok/config.toml` and `AGENTS.md`:

```bash
grok \
  --output-format streaming-json \
  --always-approve \
  --tools search_tool,use_tool \
  --disallowed-tools Agent \
  --no-plan \
  --no-subagents \
  --disable-web-search \
  -p "Use the stagehand MCP tools: open https://example.com, snapshot it, and report the heading citing the snapshot ID."
```

The example uses `--always-approve` to let Grok run tools without asking for approval.
Remove this flag to use Grok's default permissions. This command runs without an interactive
session, so it cannot accept approval responses. Tasks that require approval may fail.
