# Stagehand Deep Agents integration

`StagehandMiddleware` gives a LangChain Deep Agent (or any `create_agent` agent) one stateful
Stagehand browser through three tools: `run`, `snapshot`, and `screenshot`.
It also adds the tools' instructions to the system prompt.

```python
from deepagents import create_deep_agent
from stagehand_deepagents import RuntimeConfig, StagehandMiddleware

agent = create_deep_agent(
    model="openai:gpt-5.6-luna",
    middleware=[StagehandMiddleware(RuntimeConfig(provider="browserbase"))],
)
result = await agent.ainvoke({"messages": [{"role": "user", "content": "..."}]})
```

`RuntimeConfig` chooses the browser: `provider="local"` (the default) launches Chrome on this machine,
`provider="browserbase"` a Browserbase session (`BROWSERBASE_API_KEY`). Without a config the
middleware reads the [environment variables](#configuration) below. Each thread gets its own
browser, launched on its first browser call and closed when the agent's run ends; pass
`close_after_run=False` to keep it for the thread's next run, then `await middleware.aclose()`.

The tools are async: call the agent with `ainvoke` or `astream`.

## Run the examples

Set a model-provider key:

```bash
export OPENAI_API_KEY=...
```

The examples launch a visible local Chrome browser by default. Then run:

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

## MCP server

For other MCP clients, `stagehand-deepagents-mcp` serves the same tools over stdio. Keep one MCP session open for the browser's lifetime: a
stateless client that starts a new stdio process per call loses the browser and snapshot IDs.

## Configuration

| Variable                      | Default | Meaning                                                                                                                                                                                                |
| ----------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STAGEHAND_BROWSER`           | `local` | `local` or `browserbase`                                                                                                                                                                               |
| `STAGEHAND_HEADLESS`          | `false` | Headless local Chrome                                                                                                                                                                                  |
| `STAGEHAND_START_URL`         | unset   | Optional URL opened when the server starts                                                                                                                                                             |
| `STAGEHAND_MODEL`             | unset   | Optional model used by Stagehand AI methods inside `run`                                                                                                                                               |
| `STAGEHAND_ARTIFACT_ROOT`     | cwd     | Where screenshots saved with a `path` in `run` are written                                                                                                                                             |
| `STAGEHAND_FACADE_QUIET_WAIT` | `false` | Experimental: `page.waitForTimeout(ms)` longer than 400 ms returns once the DOM has loaded and the main document has gone 400 ms without mutations, never later than `ms`; shorter waits sleep in full |
| `BROWSERBASE_API_KEY`         | unset   | Required for Browserbase                                                                                                                                                                               |

`run` accepts exactly one of JavaScript `code` or snapshot `actions`. JavaScript executes against
the Playwright-shaped `page`, `context`, and `browser` facade. Snapshot actions use bracketed IDs
from the most recent `snapshot` call. The tools, their descriptions and schemas, and the agent
instructions come from [`stagehand-middleware`](https://pypi.org/project/stagehand-middleware/),
the same facade contract the TypeScript facade uses.

## Managed Deep Agents

The managed example lives in `examples/managed`. Its authored LangChain tools wrap
`stagehand-middleware`'s facade tools over the Python Stagehand SDK and expose the same `run`,
`snapshot`, and `screenshot` contract; `instructions.md` is the contract's agent instructions. The managed
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
