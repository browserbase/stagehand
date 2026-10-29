# Stagehand Deep Agents integration

The local examples use [`langchain-stagehand`](https://github.com/langchain-ai/langchain-browserbase)
to expose Stagehand's `run`, `snapshot`, and `screenshot` tools to Deep Agents.
See LangChain's [browser-use guide](https://docs.langchain.com/oss/python/deepagents/browser-use)
for browser choices and session scope.

## Run locally

Requires Python 3.11–3.13, [uv](https://docs.astral.sh/uv/), Chrome, and a model-provider key:

```bash
export OPENAI_API_KEY=...
cd packages/integrations/deepagents
uv run --project examples/local --locked python examples/local/agent.py
```

The model, instruction, and Pydantic response classes are declared directly in `agent.py` so the
example can be edited and rerun without passing command-line arguments. Set `response_format` to a
Pydantic model class for structured output, or `None` for the normal text response.

`agents2.py` is a form-filling example inspired by Stagehand's sensible form-filling example. The
Deep Agent navigates to the form, snapshots it, fills the requested fields with mock data, and
returns a typed Pydantic summary without submitting the form:

```bash
uv run --project examples/local --locked python examples/local/agents2.py
```

Both examples launch visible local Chrome. Set `headless=True` in `local_browser.launch` for
headless mode. For Browserbase, add `import os` and `from stagehand import browserbase`, set
`BROWSERBASE_API_KEY`, and replace the launch line with:

```python
browser = await browserbase.launch(api_key=os.environ["BROWSERBASE_API_KEY"])
```

The examples pass `tools=browser_middleware.tools` so Deep Agents' default subagent also has
browser access. Configure the client through `Stagehand.create(...)`; see the
[Stagehand integration guide](https://docs.langchain.com/oss/python/integrations/tools/stagehand) for usage.

## MCP server configuration

The standalone MCP server uses the `STAGEHAND_*` settings below. To run it from the repository root:

```bash
uv run --project packages/integrations/deepagents --locked stagehand-deepagents-mcp
```

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

For platform-managed sessions, use LangChain's [built-in browser support](https://docs.langchain.com/langsmith/python/managed-deep-agents-browser-use#browser-tools)
with `define_browser` and `browser_*` tools, including human handoff.

Our custom example in `examples/managed` owns its Browserbase sessions. Its LangChain tools wrap
`stagehand-middleware`'s facade tools over the Python Stagehand SDK and expose the same `run`,
`snapshot`, and `screenshot` contract; `instructions.md` is the contract's agent instructions. The managed
thread ID is injected by `ToolRuntime` and scopes an in-process Browserbase runtime; it is not
exposed to the model.

The managed project's lockfile uses `websockets==15.0.1`. Browser continuity is guaranteed while
the managed worker remains warm; durable reconnection after worker replacement is future work.

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
host machine.
