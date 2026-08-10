# CrewAI + Stagehand codemode tools

Give a CrewAI agent one persistent Stagehand browser through the `run`, `snapshot`, and `screenshot` tools. CrewAI connects to the shared codemode tool server over MCP/stdio, so browser state survives across tool calls.

## Prerequisites

- Node.js 24 or newer
- pnpm 11.10.0
- Python 3.11–3.13
- [uv](https://docs.astral.sh/uv/)

## Quickstart

Build the Stagehand workspace from the repository root:

```bash
corepack pnpm@11.10.0 install --frozen-lockfile
corepack pnpm@11.10.0 exec turbo run build \
  --filter @browserbasehq/stagehand-integrations
```

Install the CrewAI example:

```bash
cd packages/integrations/crewai
uv sync --locked
```

Set the credential for your CrewAI model. The example defaults to an OpenAI model:

```bash
export OPENAI_API_KEY="your-key"
export CREWAI_MODEL="openai/gpt-5.6-luna"
```

Run a browser task:

```bash
uv run python agent.py \
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
| `CREWAI_MODEL`            | CrewAI agent model. Defaults to `openai/gpt-5.6-luna`.                    |
| `OPENAI_API_KEY`          | Credential for the default CrewAI model. It stays in the CrewAI process.  |
| `STAGEHAND_BROWSER`       | `local` or `browserbase`. Inferred from `BROWSERBASE_API_KEY` when unset. |
| `BROWSERBASE_API_KEY`     | Required for Browserbase.                                                 |
| `BROWSERBASE_PROJECT_ID`  | Optional Browserbase project ID.                                          |
| `STAGEHAND_MODEL_NAME`    | Optional model for Stagehand AI methods used inside `run`.                |
| `STAGEHAND_MODEL_API_KEY` | Optional key for `STAGEHAND_MODEL_NAME`.                                  |

## Verify the integration

The contract tests start the real stdio server and need no browser or API key:

```bash
uv run pytest
```

The quickstart command above is the live browser smoke test.

## Screenshots

CrewAI's current tool loop is text-only, and its standard MCP adapter drops image blocks. This example preserves screenshots by writing each image to a temporary file and returning the file path to the agent. Open that path to inspect the image.

## Security boundary

`run` executes model-authored JavaScript inside the Stagehand browser extension's service worker, not in the CrewAI process. The MCP child receives only `STAGEHAND_*` and `BROWSERBASE_*` variables; provider credentials such as `OPENAI_API_KEY` are not forwarded.

Use Browserbase as the isolation boundary for untrusted tasks. The browser can still reach any page or data available inside its own session.
