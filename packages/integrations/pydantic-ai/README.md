# Pydantic AI + Stagehand middleware

This example registers `stagehand-middleware`'s `run`, `snapshot`, and `screenshot` as
native Pydantic AI tools. One Python-owned browser stays open for the agent run.
Instructions and tool schemas come from the middleware.
Browser calls run sequentially, and screenshots reach the model as image content.
Tested with Pydantic AI 2.57.0.

## Setup

Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/) are required, plus Google Chrome
for local browser mode. In your own Python project, install the dependencies and copy
[agent.py](agent.py) into the project:

```sh
uv add "pydantic-ai>=2.57,<3" "stagehand-middleware>=0.1.0,<0.2" "jsonschema>=4.23,<5"
```

To run from this example directory instead:

```sh
cd packages/integrations/pydantic-ai
uv sync --locked
```

| Variable | Purpose |
| --- | --- |
| `STAGEHAND_BROWSER` | `local` or `browserbase`. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`. |
| `BROWSERBASE_API_KEY` | Required for Browserbase. |
| `STAGEHAND_HEADLESS` | Set to `true` for headless local Chrome. Defaults to `false`. |
| `STAGEHAND_MODEL` / `STAGEHAND_MODEL_API_KEY` | Optional model and credential for Stagehand AI methods called inside `run`. |
| `PYDANTIC_AI_MODEL` | Agent model; defaults to `openai:gpt-6-sol`. |
| `OPENAI_API_KEY` | Credential for the default agent model. |

## Run

From the directory containing `agent.py`:

```sh
uv run python agent.py "your instruction"
```

Pass `--structured` to return a `PageReport` model (`title`, `url`, `notes`) instead of plain text.

## Browser lifecycle

The example closes the Stagehand session and browser when the agent finishes or fails.
If attaching Stagehand fails, it closes the launched browser too.

`run(code)` executes model-authored JavaScript in the browser extension service worker.
Use Browserbase for untrusted tasks. The Python process owns the browser connection
and calls the shared middleware directly.
