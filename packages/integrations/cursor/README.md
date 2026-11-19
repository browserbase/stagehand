# Cursor SDK + Stagehand facade over MCP/stdio

A runnable example built on this package's Cursor session library (`src/agent-sdk.ts`, over
`@cursor/sdk`), with the Stagehand facade
(`run` / `snapshot` / `screenshot`) mounted as the local agent's only MCP server. One Cursor
agent and one facade process stay alive for the full task, so browser state and snapshot IDs
survive across tool calls.

## Setup

Use Node.js 24 or later. From the repository root, install dependencies and build this
package and its dependencies:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations-cursor
```

Export a Cursor user or service-account API key. Browserbase is the recommended browser backend
for untrusted tasks:

```bash
export CURSOR_API_KEY=key_...
export BROWSERBASE_API_KEY=bb_live_...
export BROWSERBASE_PROJECT_ID=...
```

## Run

With local Chrome:

```bash
STAGEHAND_BROWSER=local pnpm --dir packages/integrations/cursor start -- \
  "Open https://example.com, snapshot it, and report the heading."
```

With Browserbase:

```bash
STAGEHAND_BROWSER=browserbase pnpm --dir packages/integrations/cursor start -- \
  "Open https://example.com, take a screenshot, and report the page title."
```

| Variable                  | Purpose                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `CURSOR_API_KEY`          | Cursor user or service-account key. Never forwarded to the browser process.                  |
| `CURSOR_STAGEHAND_MODEL`  | Optional Cursor model ID. Defaults to `composer-2.5`.                                        |
| `STAGEHAND_BROWSER`       | Browser backend. Defaults to Browserbase when `BROWSERBASE_API_KEY` is set, otherwise local. |
| `BROWSERBASE_API_KEY`     | Browserbase credential for the browser session.                                              |
| `BROWSERBASE_PROJECT_ID`  | Optional Browserbase project.                                                                |
| `STAGEHAND_MODEL_NAME`    | Optional model for Stagehand AI methods called inside `run`.                                 |
| `STAGEHAND_MODEL_API_KEY` | Credential for `STAGEHAND_MODEL_NAME`.                                                       |

This example intentionally uses Cursor's local agent runtime. "Local" means the agent loop and
workspace run on your machine; model inference remains hosted by Cursor. The temporary workspace
loads no ambient Cursor settings, and the agent's built-in tool allowlist contains only the `mcp`
capability. Its one inline MCP server is the Stagehand facade, so Cursor does not offer shell and
file-editing tools to the model.

The MCP child receives only non-empty `STAGEHAND_*` and `BROWSERBASE_*` variables. The Cursor API
key and unrelated host secrets remain in the agent process. `SIGINT` and `SIGTERM` cancel the
active Cursor run before the agent, MCP process, and temporary workspace are cleaned up.

## Connecting a running Cursor CLI instead

To use the facade from the interactive `agent` CLI rather than the SDK, the project-scoped
`.cursor/mcp.json` in this directory is all that's needed. Cursor automatically discovers it and
inherits the Stagehand and Browserbase exports above. Start the CLI from this directory:

```bash
cd packages/integrations/cursor
agent mcp list
agent mcp list-tools stagehand
agent
```

For a headless one-shot run, approve the configured MCP server so tool calls do not wait for an
interactive prompt:

```bash
agent -p --approve-mcps "your instruction"
```

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's service
worker, not in the Cursor agent process. Browserbase is the recommended isolation boundary: the
privileged execution environment is a disposable cloud browser.

## Evals harness adapter

The same package is the `cursor` evaluation harness adapter. Its library entry (`src/index.ts`,
built to `dist/` by `tsdown`) is what `packages/evals` imports; the example imports it through the
package's own name.

The harness uses `@cursor/sdk` with the runner's supplied MCP mount. It does not launch the Cursor
CLI or read its global MCP configuration. The SDK receives only MCP tools and disables inherited
setting sources.

Each new run records `harnessImplementation` with the adapter name (`sdk`), adapter version and
installed SDK version. Older `cursor` and `cursor_sdk` trajectories remain readable; missing
implementation metadata is not inferred to mean SDK execution. Historical CLI token usage remains
unreported.

Evaluation policy is prefixed to the task once. Cursor SDK's `systemPrompt` option replaces its
complete stock prompt and requires server entitlement, so the harness preserves the default system
prompt. Claude/Gemini native harnesses have their own system channels.

The session owns cancellation and disposal, including handles that arrive after an abort.
`events.ts` decodes both historical CLI envelopes and normalized SDK events without retaining a CLI
execution path.
