# CrewAI with Stagehand code mode

This example gives a CrewAI agent one browser tool, `code_execute`, without running generated
JavaScript in the Python agent process. A small trusted Python lease owner starts the
package-installed [Vercel Sandbox example](../vercel-sandbox) and receives its `{ url, token }`
connection. CrewAI then connects directly through authenticated Streamable HTTP:

```text
CrewAI MCPServerAdapter -> authenticated HTTPS -> Vercel Sandbox -> Stagehand code-mode MCP
                                                                  `-> generated JavaScript
```

The adapter discovers the canonical tool description and uses it as the agent's backstory. It does
not copy the executor, schema, or code-mode skill.

## Setup

Create a Python 3.12 environment and install the pinned CrewAI example dependencies:

```bash
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r packages/integrations/examples/crewai/requirements.txt
```

Build and pack the exact Stagehand packages under review:

```bash
pnpm install
pnpm --filter @browserbasehq/stagehand-integrations-example-vercel-sandbox pack:artifacts
```

## Run the end-to-end proof

```bash
STAGEHAND_SANDBOX_ARTIFACTS="$PWD/packages/integrations/examples/vercel-sandbox/.artifacts" \
BROWSERBASE_API_KEY=<api-key> \
BROWSERBASE_PROJECT_ID=<project-id> \
VERCEL_OIDC_TOKEN=<oidc-token> \
OPENAI_API_KEY=<openai-key> \
python packages/integrations/examples/crewai/e2e.py
```

For external CI, replace `VERCEL_OIDC_TOKEN` with `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and
`VERCEL_TOKEN`. Set `CREWAI_MODEL` in your own wrapper if you want to pass a model other than the
example's `openai/gpt-5-mini` default.

The proof uses one live package-installed sandbox and one context-managed CrewAI MCP adapter. It:

1. invokes `code_execute` twice directly and requires the same page ID and DOM marker;
2. records CrewAI's tool-usage event from a real model-selected `code_execute` call;
3. invokes the tool again to independently verify the model's browser-side change;
4. proves the model key and a host-only marker are absent inside generated code; and
5. closes the CrewAI MCP adapter before ending the sandbox lease, emitting `PASS` only afterward.

## Use the agent

Run the snippet with the example directory as the working directory so its local `agent.py` and
`sandbox.py` modules resolve:

```bash
cd packages/integrations/examples/crewai
```

```python
from agent import run_stagehand_agent
from sandbox import StagehandSandboxLease

with StagehandSandboxLease() as connection:
    result = run_stagehand_agent(
        connection,
        "Open https://example.com and return its title and URL.",
    )
    print(result)
```

The lease subprocess receives only Browserbase, Vercel, artifact, and runtime variables from its
allowlist. Outer model-provider credentials are intentionally excluded, and the sandbox foundation
brokers the Browserbase credential at its egress boundary.
