# LangChain Deep Agents + sandboxed Stagehand code mode

Use Stagehand code mode from a Deep Agent without running generated JavaScript on the agent host.
LangChain connects to a local stdio child, but that child is a small trusted bridge. The bridge
starts `stdio-server.mjs` as the primary process in a [Modal Sandbox](https://modal.com/docs/guide/sandboxes)
and forwards MCP bytes unchanged:

```text
Deep Agent -> local stdio -> trusted bridge -> Modal Sandbox -> Stagehand MCP
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

Create an isolated Python 3.12 environment from this directory:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

Configure Modal, Browserbase, and an immutable code-mode image. Configure the provider key for the
outer Deep Agent separately in the host environment:

```bash
export MODAL_TOKEN_ID="..."
export MODAL_TOKEN_SECRET="..."
export BROWSERBASE_API_KEY="..."
export STAGEHAND_CODEMODE_IMAGE="ghcr.io/browserbase/stagehand-codemode:<version-or-digest>"
export OPENAI_API_KEY="..."
```

`BROWSERBASE_PROJECT_ID` is optional. Modal can also use its normal local profile instead of token
environment variables. `STAGEHAND_LANGCHAIN_MODEL` selects the host model and defaults to
`openai:gpt-5-mini`.

## Run a Deep Agent

```bash
.venv/bin/python agent.py "Open example.com and return its heading and title."
```

The explicit `client.session("stagehand")` context and `load_mcp_tools(session)` call in
[`agent.py`](./agent.py) are required. Keep discovery, agent construction, and the complete
`ainvoke` inside that context. The same session then owns the same MCP process, Modal sandbox, and
browser across every `code_execute` call. Leaving the context sends EOF to the MCP, waits briefly
for Stagehand to close the browser, and terminates the sandbox if it is still running.

The canonical Stagehand V4 syntax guide from `packages/integrations/codemode/SKILL.md` is loaded as
the agent system prompt. This example does not copy the executor, schema, skill, or runtime.

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
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
.venv/bin/python smoke.py
```

The smoke discovers exactly `code_execute`, invokes it twice inside one explicit MCP session, and
verifies that the second call sees the page and DOM marker created by the first.
