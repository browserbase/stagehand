# Agno + Stagehand facade over MCP/stdio

This example connects a Python Agno agent to the Stagehand facade MCP server.
One stdio session exposes `run`, `snapshot`, and `screenshot` and keeps the browser
alive throughout the agent run. Agno's native `MCPTools` adapter passes screenshot
images to the agent model.

## Setup

Requires Node.js 24+, pnpm 11.11.0, Python 3.11–3.13, and
[uv](https://docs.astral.sh/uv/). Build the facade from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Install the example and configure its OpenAI model:

```sh
cd packages/integrations/agno
uv sync --locked
export OPENAI_API_KEY="your-openai-api-key"
uv run python agent.py "Open https://example.com and report the page title."
```

Local mode requires Google Chrome. To use Browserbase:

```sh
export STAGEHAND_BROWSER="browserbase"
export BROWSERBASE_API_KEY="your-browserbase-api-key"
```

## Configuration

| Variable                                           | Purpose                                                                                            |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `AGNO_MODEL`                                       | OpenAI model ID; defaults to `gpt-5.6-luna`. Use a vision-capable model for screenshots.           |
| `OPENAI_API_KEY`                                   | Agent model credential, kept in the Python process.                                                |
| `STAGEHAND_BROWSER`                                | `local` or `browserbase`. Defaults to Browserbase when its API key is set, otherwise local Chrome. |
| `BROWSERBASE_API_KEY`                              | Required for Browserbase.                                                                          |
| `BROWSERBASE_PROJECT_ID`                           | Optional Browserbase project ID.                                                                   |
| `STAGEHAND_MODEL_NAME` / `STAGEHAND_MODEL_API_KEY` | Optional model and key for Stagehand AI methods called inside `run`.                               |

Only `STAGEHAND_*` and `BROWSERBASE_*` variables are explicitly forwarded to the
MCP child. The agent's `OPENAI_API_KEY` stays in the host process.

## Verify

```sh
uv run pytest
uv run ruff check .
```

The tests check the facade tool contract and screenshot conversion without calling
a model provider. Keep the `async with facade_session()` context around the full
agent run when adapting this example; a new server per call loses browser state.

`run(code)` executes model-authored JavaScript inside the browser extension's
service worker. Use Browserbase to isolate untrusted tasks.

