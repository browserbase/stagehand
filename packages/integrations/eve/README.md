# Eve + Stagehand facade (native tools)

This example gives an Eve agent the native tools `run`, `snapshot`, and `screenshot`. The tools
share a durable Stagehand session directly; no MCP connection or bridge process is required.

## Setup

Use Node.js 24 or later. From the repository root, build the integrations package before running
the example:

```bash
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Configure the environment as needed:

| Variable                                                             | Purpose                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STAGEHAND_BROWSER`                                                  | Browser backend. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`.                                                        |
| `BROWSERBASE_API_KEY`                                                | Browserbase API key; required when using the Browserbase backend.                                                                                       |
| `STAGEHAND_MODEL_NAME`                                               | Optional Stagehand model name, such as `openai/gpt-5.6-luna`.                                                                                           |
| `STAGEHAND_MODEL_API_KEY`                                            | Optional explicit API key for `STAGEHAND_MODEL_NAME`; otherwise the matching provider key is inferred when supported.                                   |
| `STAGEHAND_EVE_SESSION_FILE`                                         | Optional path used to persist the Browserbase session ID; defaults to a file in the system temporary directory.                                         |
| `EVE_STAGEHAND_MODEL`                                                | Eve agent model; defaults to `gpt-5.6-luna`.                                                                                                            |
| `OPENAI_API_KEY`                                                     | OpenAI credential used by the Eve agent model and inferred for an OpenAI Stagehand model.                                                               |
| `GOOGLE_GENERATIVE_AI_API_KEY` / `GEMINI_API_KEY` / `GOOGLE_API_KEY` | Google credential inferred by Stagehand. If one is set without explicit Stagehand model configuration, the model defaults to `google/gemini-3.6-flash`. |

## Run

The tool contract tests need no network, browser, or API keys:

```bash
pnpm --filter @browserbasehq/stagehand-integrations-example-eve-facade test
pnpm --filter @browserbasehq/stagehand-integrations-example-eve-facade typecheck
```

For interactive use, set the browser and model credentials, then run:

```bash
pnpm --filter @browserbasehq/stagehand-integrations-example-eve-facade dev
```

## Security model

`run(code)` executes model-authored JavaScript in the extension service worker: it runs
browser-side, never in the host process. Browserbase is the recommended isolation boundary. The
Eve world process holds only the browser session handle; model-authored JavaScript does not execute
inside the world process.

## Session lifecycle

The example holds one shared browser session per Eve world process. Concurrent Eve sessions served
by the same process share pages, authentication, and other browser state, so this example is
intended for single-session use.

On Browserbase, the example creates a `keepAlive: true` session and persists its ID to a temporary
file. Set `STAGEHAND_EVE_SESSION_FILE` to override that path. Process restarts reattach to this
session instead of creating and stranding another one. While awaiting reuse, the session keeps
running and billing until it is reattached, released through the Browserbase dashboard or API, or
reaches the project timeout.

Errors from model-authored tool code do not reset the session. The browser session is recreated only
when its connection is unhealthy.
