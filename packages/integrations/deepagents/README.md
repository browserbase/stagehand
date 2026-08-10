# Deep Agents + Stagehand codemode tools

Give a LangChain Deep Agent the `run`, `snapshot`, and `screenshot` tools backed by one persistent Stagehand browser.

This directory includes two deployment patterns:

| Example             | Tool connection     | Browser lifecycle                          |
| ------------------- | ------------------- | ------------------------------------------ |
| `examples/local/`   | MCP over stdio      | One browser for the MCP client session     |
| `examples/managed/` | Native Python tools | One Browserbase runtime per managed thread |

## Prerequisites

- Python 3.11–3.13
- [uv](https://docs.astral.sh/uv/)
- A model-provider credential for the Deep Agent
- A current Google Chrome installation for local browser mode
- A Browserbase API key for the managed example or optional local Browserbase use

## Run the local example

From the repository root:

```bash
cd packages/integrations/deepagents
uv sync --locked
uv sync --project examples/local --locked
```

Set the credential for the model declared in `examples/local/agent.py`, then run it:

```bash
export OPENAI_API_KEY="your-key"
uv run --project examples/local --locked \
  python examples/local/agent.py
```

The example keeps the model, task, and optional Pydantic response schema in `agent.py` so you can edit and rerun one file. `agents2.py` is a structured-output form-filling example that uses mock data and does not submit the form.

Local Chrome is visible by default. To use Browserbase instead:

```bash
export STAGEHAND_BROWSER="browserbase"
export BROWSERBASE_API_KEY="your-key"
uv run --project examples/local --locked \
  python examples/local/agent.py
```

## Local server configuration

| Variable                     | Default | Purpose                                                         |
| ---------------------------- | ------- | --------------------------------------------------------------- |
| `STAGEHAND_BROWSER`          | `local` | `local` or `browserbase`.                                       |
| `STAGEHAND_HEADLESS`         | `false` | Run local Chrome headlessly.                                    |
| `STAGEHAND_CHROME_PATH`      | Unset   | Optional path to a compatible Chrome executable for local mode. |
| `STAGEHAND_CHROMIUM_SANDBOX` | `true`  | Set to `false` only in an already isolated container.           |
| `STAGEHAND_START_URL`        | Unset   | Open a URL when the MCP server starts.                          |
| `STAGEHAND_MODEL`            | Unset   | Optional model for Stagehand AI methods used inside `run`.      |
| `STAGEHAND_MODEL_API_KEY`    | Unset   | Optional key for `STAGEHAND_MODEL`.                             |
| `STAGEHAND_API_URL`          | Unset   | Optional Stagehand Model Gateway URL.                           |
| `STAGEHAND_RUN_TIMEOUT_MS`   | `60000` | Timeout for JavaScript and action batches.                      |
| `BROWSERBASE_API_KEY`        | Unset   | Required for Browserbase.                                       |

The server and client intentionally use separate Python environments. Stagehand requires `websockets>=16.1.1`, while the current LangGraph SDK used by Deep Agents requires `websockets<16`; stdio keeps those dependency sets isolated.

The example also holds one persistent MCP `ClientSession`. Do not replace it with stateless `MultiServerMCPClient.get_tools()` calls: a new stdio process per call would lose the browser and snapshot IDs.

## Deploy the managed example

The managed agent in `examples/managed/` uses native tools and a Browserbase browser. Export the variables from `.env.example` through your shell or deployment secret manager, then run:

```bash
cd packages/integrations/deepagents/examples/managed
uv sync --locked
uv run mda dev .
uv run mda deploy .
```

At minimum, configure:

- `DEEPAGENTS_MODEL` and its provider credential, such as `OPENAI_API_KEY`
- `BROWSERBASE_API_KEY`
- `STAGEHAND_API_URL` for Browserbase Model Gateway, or both `STAGEHAND_MODEL` and `STAGEHAND_MODEL_API_KEY` for direct-provider BYOK

The current LangGraph SDK still requires `websockets<16`, so the managed project pins `websockets==15.0.1`. Remove that override when the SDK ranges converge.

Browser state remains available while the managed worker is warm. Durable reconnection after worker replacement is not implemented yet.

## Verify the integration

The server contract tests need no browser or API key:

```bash
cd packages/integrations/deepagents
uv run --locked pytest
```

Running either example against a real browser is the end-to-end smoke test.

## Security boundary

`run` executes model-authored JavaScript inside the Stagehand browser extension's service worker, not in the Deep Agents process. The local MCP client forwards only `STAGEHAND_*` and `BROWSERBASE_*` variables, so the Deep Agent's provider key does not cross into the browser server.

Use Browserbase as the isolation boundary for untrusted tasks. The browser can still reach any page or data available inside its own session.

Disabling Chromium's sandbox weakens local isolation. Use `STAGEHAND_CHROMIUM_SANDBOX=false` only when the surrounding container is already the security boundary.
