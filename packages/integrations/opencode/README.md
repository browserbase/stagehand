# OpenCode SDK + Stagehand facade over MCP/stdio

A runnable example that embeds OpenCode v2 through `@opencode/sdk` in an isolated child process
and mounts the Stagehand facade (`run` / `snapshot` / `screenshot`) as its only permitted MCP server.

## Setup

Use Node.js 24 or later. From the repository root, install dependencies and build the OpenCode
adapter and its shared dependencies:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations-opencode-sdk
```

Export a supported provider API key for the SDK example. The example embeds
[`@opencode/sdk`](https://opencode.ai/v2/docs/build/sdk) from this workspace's `node_modules`;
it does not spawn a globally installed `opencode` binary. Install the
[OpenCode v2 CLI](https://opencode.ai/v2/docs) separately only for the optional interactive workflow. Configure
Browserbase when you do not want to use local Chrome:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
export BROWSERBASE_API_KEY=bb_live_...
export BROWSERBASE_PROJECT_ID=...
```

## Run

```bash
pnpm --dir packages/integrations/opencode start -- \
  "Open https://example.com, snapshot it, request a screenshot, and report the page title."
```

| Variable                  | Purpose                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| `OPENCODE_MODEL`          | Optional OpenCode model in `provider/model` form. Omit it to use OpenCode's default.         |
| Provider variables        | Credentials supported by OpenCode, such as `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`.          |
| `STAGEHAND_BROWSER`       | Browser backend. Defaults to Browserbase when `BROWSERBASE_API_KEY` is set, otherwise local. |
| `BROWSERBASE_API_KEY`     | Browserbase credential for the browser session.                                              |
| `BROWSERBASE_PROJECT_ID`  | Optional Browserbase project.                                                                |
| `STAGEHAND_MODEL_NAME`    | Optional model for Stagehand AI methods called inside `run`.                                 |
| `STAGEHAND_MODEL_API_KEY` | Credential for `STAGEHAND_MODEL_NAME`.                                                       |

The SDK host runs `@opencode/sdk` with an isolated config directory and private `HOME`, exactly one
direct Stagehand MCP server, and all non-Stagehand tools denied. The facade launches through a
wrapper that forwards only `STAGEHAND_*` and `BROWSERBASE_*` variables plus basic process variables.
MCP image results stay inside OpenCode's tool loop, so `screenshot` remains multimodal.

## Connecting a running OpenCode CLI instead

To use the facade from the interactive `opencode` CLI rather than the SDK, the project-scoped
`opencode.json` in this directory is all that's needed after installing the v2 CLI. It allows only the three Stagehand tools
and inherits your shell environment, including the Stagehand and Browserbase exports above.
Unlike the isolated SDK example, OpenCode also passes provider credentials that you export in
that shell to the facade process. If JavaScript passed to `run` uses `act`, `extract`, or
`observe`, export `STAGEHAND_MODEL_NAME` and the separate `STAGEHAND_MODEL_API_KEY`; OpenCode's
provider credential is not reused as the Stagehand credential. Start the CLI from this directory:

```bash
cd packages/integrations/opencode
opencode mcp list
opencode
```

For a headless one-shot run:

```bash
opencode run "your instruction"
```

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's
service worker — browser-side, never on your machine. Browserbase is the recommended isolation
boundary: the privileged execution environment is a disposable cloud browser. The SDK example
spawns the facade server with an explicit `STAGEHAND_*`/`BROWSERBASE_*` allowlist; OpenCode's
provider credentials never reach the browser session.
