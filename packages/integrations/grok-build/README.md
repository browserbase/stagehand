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

For programmatic runs, set `GrokBuildSessionConfig.alwaysApprove` to `true` to add the flag.
When the option is `false` or unset, the adapter omits it. The adapter closes stdin and
does not support interactive approval.

The eval harness uses the same CLI path with configuration in an isolated temporary Grok home:

```bash
evals run b:webvoyager --harness grok_build --tool stagehand_facade -l 1 -t 1 -e browserbase
```

Set `EVAL_GROK_BUILD_PATH` to override the binary, `EVAL_GROK_BUILD_MAX_TURNS` to change the
50-turn default, or `EVAL_GROK_BUILD_SANDBOX` to pass a Grok sandbox profile.

Evals enable auto-approval by default for unattended runs. Set
`EVAL_GROK_BUILD_ALWAYS_APPROVE=false` to omit the flag and retain Grok's native permission
policy. Only `true` and `false` are accepted. The effective setting is recorded in
`harnessConfiguration.alwaysApprove`.

The shared Browserbase runtime enables verified mode by default. If your project does not
support it, set `EVAL_BROWSERBASE_VERIFIED=0`. The verifier uses `google/gemini-3.5-flash`
and a Google API key (`GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY`).
