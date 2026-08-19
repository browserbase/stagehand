# Claude Agent SDK + Stagehand facade over MCP/stdio

A runnable example embedding a Claude agent via `@anthropic-ai/claude-agent-sdk`, with the
Stagehand facade (`run` / `snapshot` / `screenshot`) wired in as a stdio MCP server
programmatically — install, export keys, one line to run.

## Setup

Use Node.js 24 or later. From the repository root, build the integrations package first:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Export credentials (Browserbase is the default and recommended backend):

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export BROWSERBASE_API_KEY=bb_live_...
export BROWSERBASE_PROJECT_ID=...   # optional
```

## Run

```bash
pnpm --filter @browserbasehq/stagehand-integrations-example-claude-code-facade start "Open https://example.com, snapshot it, and report the heading citing the snapshot ID."
```

| Variable                 | Purpose                                                                                          |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| `STAGEHAND_BROWSER`      | Browser backend. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`. |
| `BROWSERBASE_API_KEY`    | Browserbase credential for the browser session.                                                  |
| `BROWSERBASE_PROJECT_ID` | Optional Browserbase project ID.                                                                 |
| `CLAUDE_STAGEHAND_MODEL` | Agent model; defaults to `claude-sonnet-5`.                                                      |
| `ANTHROPIC_API_KEY`      | Claude Agent SDK credential (never forwarded to the browser).                                    |

The agent is restricted to the three `mcp__stagehand__*` tools (`allowedTools` plus a
`canUseTool` guard — headless runs hang on unanswered permission prompts otherwise), and its
system prompt is the canonical `FACADE_AGENT_INSTRUCTIONS` imported from the facade package.

## Connecting a running Claude Code CLI instead

To use the facade from the interactive `claude` CLI rather than the SDK, the project-scoped
`.mcp.json` in this directory is all that's needed — Claude Code inherits your shell
environment, so the exports above are the only configuration:

```bash
cd packages/integrations/claude-code
claude
```

Headless one-shot form:

```bash
claude -p "your instruction" --mcp-config .mcp.json --allowedTools "mcp__stagehand__run,mcp__stagehand__snapshot,mcp__stagehand__screenshot"
```

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's
service worker — browser-side, never on your machine. Browserbase is the recommended isolation
boundary: the privileged execution environment is a disposable cloud browser. The SDK example
spawns the facade server with an explicit `STAGEHAND_*`/`BROWSERBASE_*` allowlist; your
Anthropic credentials never reach the browser session.
