# Eve + Stagehand codemode tools

Give an Eve agent native `run`, `snapshot`, and `screenshot` tools backed by one durable Stagehand session. The tools run in-process, with no MCP server or bridge process.

## Prerequisites

- Node.js 24 or newer
- pnpm 11.10.0
- A model-provider credential for Eve

## Quickstart

From the repository root:

```bash
corepack pnpm@11.10.0 install --frozen-lockfile
corepack pnpm@11.10.0 exec turbo run build \
  --filter @browserbasehq/stagehand-integrations
```

The example defaults to local Chrome and an OpenAI model:

```bash
export OPENAI_API_KEY="your-key"
corepack pnpm@11.10.0 --dir packages/integrations/eve dev
```

To run the browser on Browserbase:

```bash
export STAGEHAND_BROWSER="browserbase"
export BROWSERBASE_API_KEY="your-key"
corepack pnpm@11.10.0 --dir packages/integrations/eve dev
```

## Configuration

| Variable                     | Purpose                                                                                             |
| ---------------------------- | --------------------------------------------------------------------------------------------------- |
| `EVE_STAGEHAND_MODEL`        | Eve agent model. Defaults to `gpt-5.6-luna`.                                                        |
| `OPENAI_API_KEY`             | Credential for the default Eve model. Also inferred when an OpenAI Stagehand model is configured.   |
| `STAGEHAND_BROWSER`          | `local` or `browserbase`. Inferred from `BROWSERBASE_API_KEY` when unset.                           |
| `BROWSERBASE_API_KEY`        | Required for Browserbase.                                                                           |
| `BROWSERBASE_PROJECT_ID`     | Optional Browserbase project ID.                                                                    |
| `STAGEHAND_MODEL_NAME`       | Optional model for Stagehand AI methods used inside `run`.                                          |
| `STAGEHAND_MODEL_API_KEY`    | Optional key for `STAGEHAND_MODEL_NAME`.                                                            |
| `STAGEHAND_EVE_SESSION_FILE` | Optional file used to persist a Browserbase session ID. Defaults to the system temporary directory. |

If a Google provider key is set and `STAGEHAND_MODEL_NAME` is unset, the Stagehand model defaults to `google/gemini-3.6-flash`.

## Verify the integration

The tool contract tests need no browser or API key:

```bash
corepack pnpm@11.10.0 --dir packages/integrations/eve test
corepack pnpm@11.10.0 --dir packages/integrations/eve typecheck
```

Starting Eve with a real local or Browserbase browser is the end-to-end smoke test.

## Session lifecycle

One Eve world process owns one shared browser. Concurrent Eve sessions in that process share pages, authentication, and other browser state, so this example is intended for single-session use.

On Browserbase, the example creates a `keepAlive` session and writes its ID to a temporary file. A process restart reattaches to that session instead of silently creating another one. The session continues running—and can continue billing—until it is reattached, released through Browserbase, or reaches the project timeout.

Tool errors do not reset the browser. The integration creates a new session only when the existing connection is unhealthy.

## Security boundary

`run` executes model-authored JavaScript inside the Stagehand browser extension's service worker, not in the Eve world process. Use Browserbase as the isolation boundary for untrusted tasks. The browser can still reach any page or data available inside its own session.
