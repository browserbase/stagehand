# Pydantic AI + Stagehand facade over MCP/stdio

This example connects a Pydantic AI agent to the Stagehand facade MCP server over stdio. It
exposes the facade's `run`, `snapshot`, and `screenshot` tools to the agent and keeps one MCP
session open for the whole run so the browser and snapshot IDs stay valid.

## Setup

Node.js 24+ and [uv](https://docs.astral.sh/uv/) are required. From the repository root, build
the integrations package first so its dist server entrypoint exists:

```sh
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Then install the Python dependencies:

```sh
cd packages/integrations/pydantic-ai
uv sync
```

| Variable                                           | Purpose                                                                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGEHAND_BROWSER`                                | Browser backend. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`.                                                                      |
| `BROWSERBASE_API_KEY`                              | Browserbase API key.                                                                                                                                                  |
| `STAGEHAND_MODEL_NAME` / `STAGEHAND_MODEL_API_KEY` | Model used by the facade server and its key.                                                                                                                          |
| `PYDANTIC_AI_MODEL`                                | Pydantic AI agent model; defaults to `openai:gpt-6-sol`.                                                                                                              |
| `OPENAI_API_KEY`                                   | Used by the Pydantic AI agent model in the host process; NOT forwarded to the facade child process (the child env is an explicit `STAGEHAND_*`/`BROWSERBASE_*` allowlist). |

## Run

From `packages/integrations/pydantic-ai/`:

```sh
uv run pytest
uv run python agent.py "your instruction"
```

Pass `--structured` to return a `PageReport` model (`title`, `url`, `notes`) instead of plain text.

## Security model

`run(code)` executes model-authored JavaScript in the extension service worker:
it runs browser-side, never in the host process. Browserbase is the
recommended isolation boundary. The Python host process spawns the facade server
(a Node child process) and holds only the MCP connection; model-authored JavaScript
does not execute inside the host process.
