# Grok Build CLI + Stagehand facade over MCP/stdio

Grok Build's `grok` CLI consumes the Stagehand facade (`run` / `snapshot` / `screenshot`) as a
project MCP server through `.grok/config.toml`.

<!-- Verified against Grok Build 1.0.5. -->

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

Copy `.grok/config.toml` from this directory to your project, then replace the facade path and
Browserbase key placeholders. Grok merges project MCP configuration over its user settings.

## Run

Run from the configured project so Grok sees both `.grok/config.toml` and `AGENTS.md`:

```bash
grok -p \
  --output-format streaming-json \
  --always-approve \
  --tools search_tool,use_tool \
  --disallowed-tools Agent \
  --no-plan \
  --no-subagents \
  --disable-web-search \
  "Use the stagehand MCP tools: open https://example.com, snapshot it, and report the heading citing the snapshot ID."
```

The eval harness uses the same CLI path with an isolated temporary Grok home and project config:

```bash
evals run b:webvoyager --harness grok_build --tool stagehand_facade -l 1 -t 1 -e browserbase
```

Set `EVAL_GROK_BUILD_PATH` to override the binary, `EVAL_GROK_BUILD_MAX_TURNS` to change the
50-turn default, or `EVAL_GROK_BUILD_SANDBOX` to pass a Grok sandbox profile.
