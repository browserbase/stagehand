# Vercel AI SDK + Stagehand codemode tools

Give a Vercel AI SDK agent one persistent Stagehand browser through the `run`, `snapshot`, and `screenshot` tools. The AI SDK connects to the shared codemode tool server over MCP/stdio, so browser state survives across tool calls.

## Prerequisites

- Node.js 24 or newer
- pnpm 11.10.0
- An OpenAI API key for the example agent

## Quickstart

From the repository root:

```bash
corepack pnpm@11.10.0 install --frozen-lockfile
corepack pnpm@11.10.0 exec turbo run build \
  --filter @browserbasehq/stagehand-integrations
```

Set the credential for the AI SDK agent, then run a browser task:

```bash
export OPENAI_API_KEY="your-key"
corepack pnpm@11.10.0 --dir packages/integrations/vercel-ai start -- \
  "Open https://example.com and report the page title."
```

Local Chrome is the default. To run the browser on Browserbase:

```bash
export STAGEHAND_BROWSER="browserbase"
export BROWSERBASE_API_KEY="your-key"
```

## Configuration

| Variable                  | Purpose                                                                   |
| ------------------------- | ------------------------------------------------------------------------- |
| `AI_SDK_STAGEHAND_MODEL`  | AI SDK agent model. Defaults to `gpt-5.6-luna`.                           |
| `OPENAI_API_KEY`          | Credential for the AI SDK agent. It stays in the host process.            |
| `STAGEHAND_BROWSER`       | `local` or `browserbase`. Inferred from `BROWSERBASE_API_KEY` when unset. |
| `BROWSERBASE_API_KEY`     | Required for Browserbase.                                                 |
| `BROWSERBASE_PROJECT_ID`  | Optional Browserbase project ID.                                          |
| `STAGEHAND_MODEL_NAME`    | Optional model for Stagehand AI methods used inside `run`.                |
| `STAGEHAND_MODEL_API_KEY` | Optional key for `STAGEHAND_MODEL_NAME`.                                  |

## Verify the integration

The MCP contract tests need no browser or API key:

```bash
corepack pnpm@11.10.0 --dir packages/integrations/vercel-ai test
corepack pnpm@11.10.0 --dir packages/integrations/vercel-ai typecheck
```

The quickstart command above is the live browser smoke test.

## Security boundary

`run` executes model-authored JavaScript inside the Stagehand browser extension's service worker, not in the AI SDK process. The MCP child receives only `STAGEHAND_*` and `BROWSERBASE_*` variables plus a small set of process basics required to launch Node; the full host environment and `OPENAI_API_KEY` are not forwarded.

Use Browserbase as the isolation boundary for untrusted tasks. The browser can still reach any page or data available inside its own session.
