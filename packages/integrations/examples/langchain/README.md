# LangChain Deep Agents + Stagehand code mode

This example connects LangChain Deep Agents to the canonical Stagehand code-mode MCP server. The
server runs as a local stdio child process and exposes exactly one tool, `code_execute`.

The explicit `client.session("stagehand")` context in [`agent.py`](./agent.py) is required. Do not
replace it with `client.get_tools()`: that convenience API creates a new session for each tool call,
which would start a new stdio process and lose the browser state created by the previous call.

## Setup

Build the Stagehand-local MCP server from the repository root:

```bash
pnpm exec turbo run build --filter @browserbasehq/stagehand-integrations
```

Create an isolated Python 3.12 environment from this directory:

```bash
uv venv --python 3.12 .venv
uv pip install --python .venv/bin/python -r requirements.txt
```

## Prove persistent local-browser state

```bash
STAGEHAND_BROWSER=local .venv/bin/python smoke.py
```

The smoke launches the compiled MCP server through LangChain, discovers exactly `code_execute`,
then invokes it twice inside one explicit MCP session. The first call opens `example.com` and writes
a DOM marker; the second call proves that the same page and marker are still present.

## Run a Deep Agent

Provider credentials and Stagehand configuration are inherited by the MCP child. For example:

```bash
export OPENAI_API_KEY=<your-provider-key>
export STAGEHAND_BROWSER=local
.venv/bin/python agent.py "Open example.com and return its heading and title."
```

To use Browserbase instead, set `STAGEHAND_BROWSER=browserbase`, `BROWSERBASE_API_KEY`, and
optionally `BROWSERBASE_PROJECT_ID`. You can select another supported model with
`STAGEHAND_LANGCHAIN_MODEL`; it defaults to `openai:gpt-5-mini` for the Deep Agent.

The canonical Stagehand V4 syntax guide from `packages/integrations/codemode/SKILL.md` is loaded as
the agent system prompt. This example does not copy the executor, schema, skill, or runtime.
