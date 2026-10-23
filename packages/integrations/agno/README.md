# Agno + Stagehand middleware

This example registers `stagehand-middleware`'s `run`, `snapshot`, and `screenshot` as
native Agno tools. One browser stays open for the agent run. Instructions and tool
schemas come from the middleware. Browser calls run sequentially, and screenshots
reach the model as image content. Tested with Agno 3.1.5.

## Setup

Requires Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/), plus Google Chrome
for local browser mode. In your own Python project, install the dependencies and
copy [agent.py](agent.py) into the project:

```sh
uv add "agno>=3.1.5,<4" "openai>=2,<3" "stagehand-middleware>=0.1.0,<0.2" "jsonschema>=4.23,<5"
```

To run from this example directory instead:

```sh
cd packages/integrations/agno
uv sync --locked
```

Configure the model and run from the directory containing `agent.py`:

```sh
export OPENAI_API_KEY="your-openai-api-key"
uv run python agent.py "Open https://example.com and report the page title."
```

## Configuration

| Variable | Purpose |
| --- | --- |
| `AGNO_MODEL` | OpenAI model ID; defaults to `gpt-5.6-luna`. Use a vision-capable model for screenshots. |
| `OPENAI_API_KEY` | Agent model credential. |
| `OPENAI_BASE_URL` | Optional OpenAI-compatible gateway endpoint. |
| `STAGEHAND_BROWSER` | `local` or `browserbase`. Defaults to Browserbase when its API key is set, otherwise local Chrome. |
| `BROWSERBASE_API_KEY` | Required for Browserbase. |
| `STAGEHAND_HEADLESS` | Set to `true` for headless local Chrome. Defaults to `false`. |
| `STAGEHAND_MODEL` / `STAGEHAND_MODEL_API_KEY` | Optional model and credential for Stagehand AI methods called inside `run`. |

## Browser lifecycle

Keep one `browser_session()` open around the complete agent run so page state and
snapshot IDs survive across calls. The example closes the Stagehand session and
browser when the agent finishes or fails.

`run(code)` executes model-authored JavaScript inside the browser extension's
service worker. Use Browserbase to isolate untrusted tasks.

## Verify

```sh
uv run pytest
uv run ruff check .
```
