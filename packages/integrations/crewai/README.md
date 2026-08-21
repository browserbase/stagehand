# CrewAI + Stagehand facade over MCP/stdio

This example connects CrewAI, via a screenshot-preserving subclass of `crewai-tools`' MCP
adapter, to the Stagehand facade MCP server over stdio. It exposes the facade's `run`,
`snapshot`, and `screenshot` tools to a CrewAI agent.

## Setup

Node.js 24+ and [uv](https://docs.astral.sh/uv/) are required. From the repository root, build
the integrations package first so its dist server entrypoint exists:

```sh
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Then install the Python dependencies:

```sh
cd packages/integrations/crewai
uv sync
```

| Variable                                           | Purpose                                                                                                                                                               |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGEHAND_BROWSER`                                | Browser backend. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`.                                                                      |
| `BROWSERBASE_API_KEY`                              | Browserbase API key.                                                                                                                                                  |
| `STAGEHAND_MODEL_NAME` / `STAGEHAND_MODEL_API_KEY` | Model used by the facade server and its key.                                                                                                                          |
| `CREWAI_MODEL`                                     | CrewAI agent model; defaults to `openai/gpt-5.6-luna`.                                                                                                                |
| `OPENAI_API_KEY`                                   | Used by the CrewAI agent model in the host process; NOT forwarded to the facade child process (the child env is an explicit `STAGEHAND_*`/`BROWSERBASE_*` allowlist). |

## Run

From `packages/integrations/crewai/`:

```sh
uv run pytest
uv run python agent.py "your instruction"
```

## Screenshots

CrewAI's tool loop is text-only in this version, and `crewai-tools`' MCP adapter drops MCP image
blocks. This example saves each screenshot to a temporary file and returns its path to the agent;
open the file to inspect it.

## Security model

`run(code)` executes model-authored JavaScript in the extension service worker:
it runs browser-side, never in the host process. Browserbase is the
recommended isolation boundary. The Python host process spawns the facade server
(a Node child process) and holds only the MCP connection; model-authored JavaScript
does not execute inside the host process.
