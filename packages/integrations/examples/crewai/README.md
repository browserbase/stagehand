# CrewAI + Stagehand code mode

This example gives a CrewAI agent the canonical Stagehand `code_execute` tool over stdio. It starts
one `packages/integrations/dist/codemode/stdio-server.mjs` child for the complete agent run, so later
tool calls reuse the browser state created by earlier calls. Leaving the adapter context closes the
MCP connection and its child process.

The server inherits the current environment. Select the browser without changing the example:

```bash
STAGEHAND_BROWSER=local
STAGEHAND_BROWSER=browserbase
```

Browserbase mode also requires `BROWSERBASE_API_KEY`; `BROWSERBASE_PROJECT_ID` is optional. If the
agent calls Stagehand AI methods, configure a supported model provider key or set
`STAGEHAND_MODEL_NAME` and `STAGEHAND_MODEL_API_KEY` explicitly.

## Setup

From the Stagehand repository root, build the exact MCP under review and install the Python example
in an isolated environment:

```bash
pnpm turbo run build --filter @browserbasehq/stagehand-integrations
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r packages/integrations/examples/crewai/requirements.txt
```

Run the deterministic smoke. It discovers exactly `code_execute`, invokes that CrewAI tool twice
against a real local browser, and verifies that the second call sees state left by the first:

```bash
python packages/integrations/examples/crewai/smoke.py
```

To run a model-driven agent, provide the outer CrewAI model credential and call the helper from the
example directory while the Stagehand server configuration remains in the environment:

```bash
cd packages/integrations/examples/crewai
```

```python
from agent import run_stagehand_agent

result = run_stagehand_agent(
    "Open https://example.com and return its title and URL.",
    llm="openai/gpt-5-mini",
)
print(result)
```

`run_stagehand_agent` keeps CrewAI's context-managed `MCPServerAdapter` open through `kickoff`.
This is important for stateful browser work: each `code_execute` call must reach the same stdio MCP
process rather than launching a new browser.
