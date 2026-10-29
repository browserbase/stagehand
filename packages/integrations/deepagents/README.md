# Stagehand Deep Agents integration

The local examples use the published [`langchain-stagehand`](https://pypi.org/project/langchain-stagehand/)
package maintained in [LangChain's integration repository](https://github.com/langchain-ai/langchain-browserbase).
Its `StagehandMiddleware` exposes `run`, `snapshot`, and `screenshot`, includes browser guidance in tool descriptions,
and returns screenshots as model-visible images. Browserbase maintains the underlying `stagehand`
SDK and `stagehand-middleware` facade; the LangChain adapter lives upstream.

This directory also retains the stdio MCP server, evaluation runner, and Managed Deep Agents example.
These are separate consumers of the facade, not copies of the native middleware.

## Run the examples

Use Python 3.11–3.13, [uv](https://docs.astral.sh/uv/), and Chrome for the default local browser:

```bash
cd packages/integrations/deepagents
export OPENAI_API_KEY=...
uv sync --project examples/local --locked
uv run --project examples/local --locked python examples/local/agent.py
```

Edit `model`, `instruction`, and `response_format` in the script. `agent.py` returns a Pydantic sports
summary; set `response_format = None` for a plain text response. `agents2.py` fills a form with mock
data without submitting it:

```bash
uv run --project examples/local --locked python examples/local/agents2.py
```

Both scripts open visible local Chrome with `local_browser.launch(headless=False)`, create a
Stagehand client, and pass it to `StagehandMiddleware(stagehand=stagehand)`. A `finally` block
closes the browser (and its attached Stagehand client), including if setup or invocation fails.

For Browserbase, add `import os` and `from stagehand import browserbase`, set `BROWSERBASE_API_KEY`, and
replace the launch line with:

```python
browser = await browserbase.launch(api_key=os.environ["BROWSERBASE_API_KEY"])
```

For headless local Chrome, set `headless=True` in `local_browser.launch`.

## Migrating from the local MCP example

- Install `langchain-stagehand>=0.0.1,<0.1` and import `StagehandMiddleware` from `langchain_stagehand`.
- Create a browser and Stagehand client using the SDK, then replace MCP tool loading with
  `middleware=[StagehandMiddleware(stagehand=stagehand)]`.
- The adapter includes browser guidance in tool descriptions and leaves the system prompt untouched.
  The examples no longer inject `facade_instructions()`; application-specific system prompts can
  still be passed to `create_deep_agent`.
- Use `ainvoke` or `astream` and close the browser in `finally`. The client persists across calls
  until you close it. Give unrelated conversations separate clients/browsers; one middleware
  instance does not provide per-thread isolation or automatic reconnection.
- Configure the SDK explicitly. `STAGEHAND_BROWSER`, `STAGEHAND_HEADLESS`, and `STAGEHAND_START_URL`
  were MCP-server settings and are not read by these examples. Select the browser factory, pass
  launch options, and navigate through the SDK or agent task. Pass optional AI settings through
  `Stagehand.create(...)`; see the [upstream API examples](https://github.com/langchain-ai/langchain-browserbase#readme).
- The released adapter does not expose the server's `STAGEHAND_ARTIFACT_ROOT` or
  `STAGEHAND_FACADE_QUIET_WAIT` settings. Screenshots saved by run code use the current working
  directory, not a Deep Agents backend.
- No MCP subprocess or separate server environment is needed for these local examples. Their
  lockfile resolves the agent and Stagehand dependencies together.

The existing `stagehand-deepagents` package is the MCP server, not an alias for `langchain-stagehand`.
The managed example has its own per-thread lifecycle and is not migrated by changing this import.

## Retained MCP server

For MCP clients and the existing evaluation runner, the stdio server remains available:

```bash
uv run --project packages/integrations/deepagents --locked stagehand-deepagents-mcp
```

Run this from the repository root, or configure your MCP client to launch that command. Keep one
persistent MCP client session: starting a new server process for each call loses browser state and
snapshot IDs. The settings below apply to this server, not to the native middleware.

## Server configuration

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

This managed project retains its existing lockfile and `websockets==15.0.1` override; its dependency
and lifecycle migration is separate from the local examples. Browser continuity is guaranteed while the managed
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

`run` executes model-authored JavaScript inside the Stagehand browser extension's service worker,
not in the Python host process. Use disposable Browserbase sessions for untrusted browsing tasks
and avoid sharing a session across unrelated users. The native middleware runs in the agent's
Python process; it does not provide the old MCP subprocess environment separation. Keep credentials
in application configuration rather than model-visible tool arguments.
