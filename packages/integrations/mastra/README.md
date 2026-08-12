# Mastra + Stagehand codemode tools

Give a Mastra agent one persistent Stagehand browser through the `run`, `snapshot`, and `screenshot` tools. Mastra connects to the shared codemode tool server over MCP/stdio, so other MCP-capable frameworks can reuse the same contract.

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

Set the credential for the Mastra agent, then run a browser task:

```bash
export OPENAI_API_KEY="your-key"
corepack pnpm@11.10.0 --dir packages/integrations/mastra start -- \
  "Open https://example.com and report the page title."
```

Local Chrome is the default. To run the browser on Browserbase:

```bash
export STAGEHAND_BROWSER="browserbase"
export BROWSERBASE_API_KEY="your-key"
```

## Configuration

| Variable                  | Purpose                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------ |
| `MASTRA_STAGEHAND_MODEL`  | Mastra agent model. Defaults to `gpt-5.6-luna`.                                                  |
| `OPENAI_API_KEY`          | Credential for the Mastra agent. It stays in the Mastra process.                                 |
| `STAGEHAND_BROWSER`       | `local` or `browserbase`. Inferred from `BROWSERBASE_API_KEY` when unset.                        |
| `BROWSERBASE_API_KEY`     | Required for Browserbase.                                                                        |
| `BROWSERBASE_PROJECT_ID`  | Optional Browserbase project ID.                                                                 |
| `STAGEHAND_MODEL_NAME`    | Optional model for Stagehand AI methods used inside `run`.                                       |
| `STAGEHAND_MODEL_API_KEY` | Required with `STAGEHAND_MODEL_NAME`; the MCP child does not receive agent-provider credentials. |

## Verify the integration

The MCP contract tests need no browser or API key:

```bash
corepack pnpm@11.10.0 --dir packages/integrations/mastra test
corepack pnpm@11.10.0 --dir packages/integrations/mastra typecheck
```

The quickstart command above is the live browser smoke test.

## Security boundary

`run` executes model-authored JavaScript inside the Stagehand browser extension's service worker, not in the Mastra process. The MCP child receives only `STAGEHAND_*` and `BROWSERBASE_*` variables plus a small set of process basics required to launch Node; the full host environment and `OPENAI_API_KEY` are not forwarded.

Use Browserbase as the isolation boundary for untrusted tasks. The browser can still reach any page or data available inside its own session.
