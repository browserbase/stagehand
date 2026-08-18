# OpenCode SDK + Stagehand facade over MCP/stdio

A runnable example that embeds OpenCode through `@opencode-ai/sdk`, starts one local OpenCode
server, and mounts the Stagehand facade (`run` / `snapshot` / `screenshot`) as its only enabled
MCP tool surface.

## Setup

Use Node.js 24 or later. From the repository root, install dependencies and build the shared
integration package:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Authenticate a provider with `opencode auth login`, or export its supported API key. Configure
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

The SDK server runs with isolated config discovery, exactly one inline Stagehand MCP server, and
all non-Stagehand tools disabled and denied. Only `STAGEHAND_*` and `BROWSERBASE_*` variables
cross into the MCP child; provider credentials remain in OpenCode. Native MCP image results stay
inside OpenCode's tool loop, so `screenshot` remains multimodal.
