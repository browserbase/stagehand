# CrewAI + sandboxed Stagehand code mode

Use Stagehand code mode as one CrewAI tool without running generated JavaScript on the agent host.
CrewAI still connects to a local stdio child, but that child is a small trusted bridge. The bridge
starts `stdio-server.mjs` as the primary process in a [Modal Sandbox](https://modal.com/docs/guide/sandbox)
and forwards MCP bytes unchanged:

```text
CrewAI -> local stdio -> trusted bridge -> Modal Sandbox -> Stagehand MCP
                                                     `-> generated JavaScript
```

The agent's model credential remains in the host process. The bridge gives the sandbox only
`STAGEHAND_BROWSER=browserbase`, `BROWSERBASE_API_KEY`, optional `BROWSERBASE_PROJECT_ID`, and the
optional Stagehand-specific `STAGEHAND_MODEL_NAME` and `STAGEHAND_MODEL_API_KEY` pair. Set that pair
only when generated code needs AI-backed Stagehand methods such as `act` or `extract`.

> The proposed `ghcr.io/browserbase/stagehand-codemode` image is not published yet. Until it is,
> maintainers can set `STAGEHAND_CODEMODE_MODAL_IMAGE_ID` to an image built from the same Stagehand
> commit. Once published, pin `STAGEHAND_CODEMODE_IMAGE` to a version or digest instead of a mutable
> `latest` tag.

## Setup

Create a Python 3.12 environment and install the example:

```bash
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r packages/integrations/examples/crewai/requirements.txt
```

Configure Modal, Browserbase, and an immutable code-mode image. Configure the model provider key
required by `DEFAULT_STAGEHAND_LLM` (`openai/gpt-5-mini`) separately in the host environment:

```bash
export MODAL_TOKEN_ID="..."
export MODAL_TOKEN_SECRET="..."
export BROWSERBASE_API_KEY="..."
export STAGEHAND_CODEMODE_IMAGE="ghcr.io/browserbase/stagehand-codemode:<version-or-digest>"
export OPENAI_API_KEY="..."
```

`BROWSERBASE_PROJECT_ID` is optional. Modal can also use its normal local profile instead of token
environment variables.

## Run an agent

Run from `packages/integrations/examples/crewai`:

```python
from agent import run_stagehand_agent

result = run_stagehand_agent(
    "Open https://example.com and return its title and URL."
)
print(result)
```

`run_stagehand_agent` keeps one context-managed `MCPServerAdapter` open for the complete `kickoff`.
That lifecycle matters: every `code_execute` call reaches the same MCP process, sandbox, and browser.
Leaving the context sends EOF to the MCP, gives Stagehand a chance to close the browser, and then
terminates the sandbox if it is still running.

## Sandbox policy

The bridge defaults to a 10-minute hard timeout, a 5-minute idle timeout, and outbound access only
to `*.browserbase.com`. Adjust them only when the task requires it:

```bash
export STAGEHAND_CODEMODE_TIMEOUT_SECONDS=900
export STAGEHAND_CODEMODE_IDLE_TIMEOUT_SECONDS=300
export STAGEHAND_CODEMODE_OUTBOUND_DOMAINS="*.browserbase.com,api.example.com"
```

Each extra domain is reachable by arbitrary generated JavaScript, so keep the list task-specific.
The Browserbase credential is intentionally present inside the sandbox and should be scoped and
rotated accordingly. The hard timeout is the final cleanup backstop if generated synchronous code
cannot be interrupted cooperatively.

## Local CI smoke

The deterministic smoke starts the MCP directly on the CI runner with a local browser. It is useful
for secret-free protocol and persistence coverage, but it is not the recommended boundary for
production or untrusted prompts:

```bash
pnpm turbo run build --filter @browserbasehq/stagehand-integrations
python packages/integrations/examples/crewai/smoke.py
```
