# Flue + Stagehand facade (native tools)

This example gives a Flue agent the native tools `run`, `snapshot`, and `screenshot`. The tools
share a Stagehand session directly; no MCP connection or bridge process is required.

## Setup

Use Node.js 24 or later. From the repository root, build the integrations package before running
the example:

```bash
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Configure the environment as needed:

| Variable                  | Purpose                                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------------------- |
| `STAGEHAND_BROWSER`       | Browser backend. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`.      |
| `BROWSERBASE_API_KEY`     | Browserbase API key.                                                                                  |
| `STAGEHAND_MODEL_NAME`    | Optional Stagehand model name, such as `openai/gpt-5.6-luna`.                                         |
| `STAGEHAND_MODEL_API_KEY` | Optional explicit API key for `STAGEHAND_MODEL_NAME`; otherwise a supported provider key is inferred. |
| `FLUE_STAGEHAND_MODEL`    | Flue agent model; defaults to `openai/gpt-5.6-luna`.                                                  |
| `OPENAI_API_KEY`          | Used by the Flue agent model in the host process.                                                     |

## Run

```bash
pnpm --filter @browserbasehq/stagehand-integrations-example-flue-facade test
pnpm --filter @browserbasehq/stagehand-integrations-example-flue-facade typecheck
pnpm --filter @browserbasehq/stagehand-integrations-example-flue-facade start \
  "Open https://example.com and report the page title."
```

## Screenshots

Flue's current tool loop is text-only. This example saves each screenshot to a temporary file and
returns its path and MIME type to the agent; open the file to inspect it.

## Security model

`run(code)` executes model-authored JavaScript in the extension service worker:
it runs browser-side, never in the host process. Browserbase is the
recommended isolation boundary. The Flue process holds only the browser session
handle; model-authored JavaScript does not execute inside the host process.

## Session lifecycle

One CLI run owns one lazily-created browser session. All three tools reuse that browser, so page
state and snapshot IDs survive between tool calls. The browser closes when the Flue run finishes
or is interrupted.
