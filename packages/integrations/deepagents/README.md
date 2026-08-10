# Stagehand Deep Agents integration

This local integration exposes one stateful Stagehand browser to LangChain Deep Agents through a
stdio MCP server. Its complete tool surface is `run`, `snapshot`, and `screenshot`.

## Run locally

Set a model-provider key and select the Deep Agents model:

```bash
export OPENAI_API_KEY=...
export DEEPAGENTS_MODEL=openai:gpt-5.6-luna
```

The MCP server launches a local headless Chrome browser by default. Then run:

```bash
cd packages/integrations/deepagents
uv run --project examples/local python examples/local/agent.py
```

The model, instruction, and Pydantic response classes are declared directly in `agent.py` so the
example can be edited and rerun without passing command-line arguments. Set `response_format` to a
Pydantic model class for structured output, or `None` for the normal text response.

`agents2.py` is a form-filling example inspired by Stagehand's sensible form-filling example. The
Deep Agent navigates to the form, snapshots it, fills the requested fields with mock data, and
returns a typed Pydantic summary without submitting the form:

```bash
uv run --project examples/local python examples/local/agents2.py
```

To use Browserbase instead:

```bash
export STAGEHAND_BROWSER=browserbase
export BROWSERBASE_API_KEY=...
uv run --project examples/local python examples/local/agent.py
```

Browserbase sessions use a 1280 × 720 viewport by default.

The server and client intentionally use separate Python environments. Stagehand currently requires
`websockets>=16.1.1`, while the current LangGraph SDK used by Deep Agents requires `websockets<16`.
The stdio transport isolates those dependency sets.

The example deliberately creates a persistent MCP `ClientSession`. Do not replace it with
`MultiServerMCPClient.get_tools()`: the default stateless tools create a new stdio process for each
call and therefore lose the browser and snapshot IDs.

## Server configuration

| Variable                   | Default | Meaning                                                  |
| -------------------------- | ------- | -------------------------------------------------------- |
| `STAGEHAND_BROWSER`        | `local` | `local` or `browserbase`                                 |
| `STAGEHAND_HEADLESS`       | `true`  | Headless local Chrome                                    |
| `STAGEHAND_START_URL`      | unset   | Optional URL opened when the server starts               |
| `STAGEHAND_MODEL`          | unset   | Optional model used by Stagehand AI methods inside `run` |
| `STAGEHAND_RUN_TIMEOUT_MS` | `60000` | Callback-batch timeout                                   |
| `BROWSERBASE_API_KEY`      | unset   | Required for Browserbase                                 |

`run` accepts exactly one of JavaScript `code` or snapshot `actions`. JavaScript executes against
the Playwright-shaped `page`, `context`, and `browser` facade. Snapshot actions use bracketed IDs
from the most recent `snapshot` call.

## Managed Deep Agents

The managed example lives in `examples/managed`. Its authored LangChain tools run the Python
Stagehand SDK directly and expose the same `run`, `snapshot`, and `screenshot` contract. The managed
thread ID is injected by `ToolRuntime` and scopes an in-process Browserbase runtime; it is not
exposed to the model.

The current LangGraph SDK requires `websockets<16`, while Stagehand declares `websockets>=16.1.1`.
For this spike, the managed project overrides the shared dependency to `websockets==15.0.1`. Remove
the override once the SDK ranges converge. Browser continuity is guaranteed while the managed
worker remains warm; durable reconnection after worker replacement is future work.

### Develop and deploy the managed agent

From `examples/managed`, copy `.env.example` to `.env` and configure:

- `DEEPAGENTS_MODEL` and the matching provider key, such as `OPENAI_API_KEY`.
- `BROWSERBASE_API_KEY` for the hosted browser.
- Either `STAGEHAND_API_URL` for Browserbase Model Gateway, or `STAGEHAND_MODEL` plus
  `STAGEHAND_MODEL_API_KEY` for direct-provider BYOK.

Then run:

```bash
uv sync
uv run mda dev .
uv run mda deploy .
```

Managed Deep Agents forwards non-reserved `.env` entries as deployment secrets. The agent model key
and the optional Stagehand model key are independent: users can bring their own key for either,
while Browserbase Model Gateway remains the zero-additional-key Stagehand path.

The published `stagehand` wheel bundles the browser extension and `browserbase.launch` provisions
it automatically. Set `STAGEHAND_EXTENSION_ID` to reuse a pre-uploaded extension instead.

## Security model

The `run` tool executes model-authored JavaScript inside the Stagehand browser extension's service
worker — browser-side, never in the host process. Browserbase is the recommended isolation
boundary: the privileged execution environment is a disposable cloud browser with no access to the
host machine. Only `STAGEHAND_*` and `BROWSERBASE_*` environment variables are forwarded to the
browser session; host secrets such as the deep-agent model key never reach it.
