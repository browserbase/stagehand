# Mastra + Stagehand facade over MCP/stdio

This example connects Mastra to the Stagehand facade MCP server over stdio. It
exposes the facade's `run`, `snapshot`, and `screenshot` tools to a Mastra agent
under those exact names (`toolNames: "bare"`), using agent instructions imported
from the integrations package.

`src/facade.ts` is the mount (the facade stdio server as a Mastra MCP server
definition); `src/agent.ts` runs it through `runMastraSession`, the same session
adapter evals uses for `--harness mastra` (exported from `src/index.ts`). Evals
keeps the adapter's default server-namespaced names (`stagehand_run`, ...).

This route wraps the facade as an MCP server over stdio, so any MCP-capable
framework (here, Mastra) can consume the identical tool contract without
Stagehand-specific glue, at the cost of a child process and JSON-RPC hop.
Alternatively, the same contract can be bound as native in-process tools sharing
a durable Stagehand session, with no bridge process but framework-specific code.

## Setup

Node.js 24 or newer is required. From the repository root, build this package
(turbo builds its workspace dependencies, including the facade server, first):

```sh
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations-mastra
```

Configure the environment as needed:

| Variable                  | Purpose                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGEHAND_BROWSER`       | Browser backend. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`.                                                        |
| `BROWSERBASE_API_KEY`     | Browserbase API key.                                                                                                                                    |
| `STAGEHAND_MODEL_NAME`    | Model used by the facade server.                                                                                                                        |
| `STAGEHAND_MODEL_API_KEY` | API key for the facade server model.                                                                                                                    |
| `MASTRA_STAGEHAND_MODEL`  | Mastra agent model; defaults to `gpt-5.6-luna` (bare ids use OpenAI, or pass `provider/model`).                                                         |
| `OPENAI_API_KEY`          | Used by the default agent model in the host process; other providers need their own key (e.g. `ANTHROPIC_API_KEY`). Not forwarded to the facade server. |

## Run

```sh
pnpm --filter @browserbasehq/stagehand-integrations-mastra test
pnpm --filter @browserbasehq/stagehand-integrations-mastra typecheck
pnpm --filter @browserbasehq/stagehand-integrations-mastra start "your instruction"
```

## Security model

`run(code)` executes model-authored JavaScript in the extension service worker:
it runs browser-side, never in the Node host process. Browserbase is the
recommended isolation boundary. The Node host process spawns the facade server
and holds only the MCP connection; model-authored JavaScript does not execute
inside the host process.

The child process receives `STAGEHAND_*` and `BROWSERBASE_*` environment variables plus the MCP
transport's safe defaults (HOME, PATH, SHELL, TERM, USER, LOGNAME) — never the full host
variables; the host's complete environment is never forwarded.
