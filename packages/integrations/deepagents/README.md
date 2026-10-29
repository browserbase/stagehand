# Stagehand Deep Agents integration

The local examples use [`langchain-stagehand`](https://github.com/langchain-ai/langchain-browserbase),
the LangChain-maintained adapter for Stagehand's `run`, `snapshot`, and `screenshot` tools.

## Run the examples

Requires Python 3.11–3.13, [uv](https://docs.astral.sh/uv/), and Chrome:

```bash
cd packages/integrations/deepagents
export OPENAI_API_KEY=...
uv sync --project examples/local --locked
uv run --project examples/local --locked python examples/local/agent.py
```

Edit `model`, `instruction`, and `response_format` in the script. Run `agents2.py` for form filling
with mock data without submission. Both examples use visible local Chrome; set `headless=True`
in `local_browser.launch` for headless mode.

For Browserbase, add `import os` and `from stagehand import browserbase`, set `BROWSERBASE_API_KEY`,
and replace the launch line with:

```python
browser = await browserbase.launch(api_key=os.environ["BROWSERBASE_API_KEY"])
```

The examples pass `tools=browser_middleware.tools` alongside `middleware=[browser_middleware]`
so Deep Agents' default subagent inherits the browser tools. Both share the same browser.
Configure the SDK directly; the `STAGEHAND_*` server settings below do not apply to these examples.
See the [adapter documentation](https://github.com/langchain-ai/langchain-browserbase#readme) for options.

## MCP server

The MCP server and evaluation runner remain available. From the repository root:

```bash
uv run --project packages/integrations/deepagents --locked stagehand-deepagents-mcp
```

Keep one persistent MCP client session to preserve browser state and snapshot IDs.

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

`examples/managed` uses thread-scoped Browserbase tools over `stagehand-middleware`.
Browser state persists while the worker is warm; reconnection after worker replacement is not
supported. This project has its own dependencies and retains its `websockets==15.0.1` override.

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

`run` executes model-authored JavaScript in the browser extension's service worker. Use disposable
Browserbase sessions for untrusted tasks and separate browsers for unrelated users. Keep credentials
in application configuration rather than tool arguments.
