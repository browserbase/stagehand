# Pydantic AI + Stagehand middleware

This example registers `stagehand-middleware`'s `run`, `snapshot`, and `screenshot` as
native Pydantic AI tools. Browser calls run sequentially in one session, and screenshots reach
the model as image content.
Tested with Pydantic AI 2.67.0.

## Setup

Python 3.11–3.13 and [uv](https://docs.astral.sh/uv/) are required, plus Google Chrome
for local browser mode. In your own Python project, install the dependencies and copy
[agent.py](agent.py) into the project:

```sh
uv add "pydantic-ai>=2.67,<3" "stagehand-middleware>=0.1.2,<0.2" "jsonschema>=4.23,<5"
```

To run from this example directory instead:

```sh
cd packages/integrations/pydantic-ai
uv sync --locked
```

## Configuration

| Variable                                      | Purpose                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `STAGEHAND_BROWSER`                           | `local` or `browserbase`. Defaults to `browserbase` when `BROWSERBASE_API_KEY` is set, otherwise `local`. |
| `BROWSERBASE_API_KEY`                         | Required for Browserbase.                                                                                 |
| `STAGEHAND_HEADLESS`                          | Set to `true` for headless local Chrome. Defaults to `false`.                                             |
| `STAGEHAND_MODEL` / `STAGEHAND_MODEL_API_KEY` | Optional model and credential for Stagehand AI methods called inside `run`.                               |
| `PYDANTIC_AI_MODEL`                           | Agent model; defaults to `openai:gpt-6-sol`.                                                              |
| `OPENAI_API_KEY`                              | Credential for the default agent model.                                                                   |

## Run

Configure the model and run from the directory containing `agent.py`:

```sh
export OPENAI_API_KEY="your-openai-api-key"
uv run python agent.py "Open https://example.com and report the page title."
```

Pass `--structured` to return a `PageReport` model (`title`, `url`, `notes`) instead of plain text.

## Browser session

Keep one `browser_session()` open around the agent run so page state and snapshot
IDs survive across calls. The example closes the session and browser when the run ends.

`run(code)` executes model-authored JavaScript in the browser extension service worker.
Use Browserbase for untrusted tasks.

## Eval runner

The `pydantic_ai` harness starts [`runner/run_eval.py`](runner/run_eval.py) through
the TypeScript session adapter in `src/`. The eval runtime supplies the MCP tools,
owns the browser session, and captures evidence from that session.

Complete the [eval workspace setup](../../evals/README.md#quickstart), then run:

```sh
evals run b:webvoyager --harness pydantic_ai --tool stagehand_facade -l 1 -t 1 -e browserbase
```

Run the example and runner tests from this directory:

```sh
uv run --locked pytest
```
