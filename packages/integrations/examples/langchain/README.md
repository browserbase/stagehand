# LangChain Deep Agents with Stagehand code mode

This example gives a Deep Agent one browser tool, `code_execute`, without running generated
JavaScript in the Python agent process. A small trusted Python lease owner starts the
package-installed [Vercel Sandbox example](../vercel-sandbox) and receives its `{ url, token }`
connection. LangChain then connects directly through authenticated Streamable HTTP:

```text
Deep Agent -> persistent LangChain MCP session -> authenticated HTTPS -> Vercel Sandbox
                                                                       `-> Stagehand MCP
                                                                           `-> generated JavaScript
```

The integration discovers the package's canonical tool description and uses it as the agent system
prompt. It does not copy the executor, schema, or code-mode skill.

## Setup

Create a Python 3.12 environment and install the exact tested dependencies:

```bash
python3.12 -m venv .venv
. .venv/bin/activate
python -m pip install -r packages/integrations/examples/langchain/requirements.txt
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
python packages/integrations/examples/langchain/e2e.py
```

For external CI, replace `VERCEL_OIDC_TOKEN` with `VERCEL_TEAM_ID`, `VERCEL_PROJECT_ID`, and
`VERCEL_TOKEN`. `STAGEHAND_LANGCHAIN_MODEL` selects the host model for the standalone agent and
defaults to `openai:gpt-5-mini`.

The proof uses one live package-installed sandbox and one explicit LangChain MCP session. It:

1. invokes `code_execute` twice directly and requires the same page ID and DOM marker;
2. requires a real Deep Agent model to select `code_execute` inside that same session;
3. invokes the tool again to independently verify the model's browser-side change;
4. proves the model key and a host-only marker are absent inside generated code; and
5. closes the LangChain MCP session before ending the sandbox lease, emitting `PASS` only afterward.

The explicit `client.session("stagehand")` context and `load_mcp_tools(session)` call are important.
LangChain's convenience tool loader is stateless by default and would otherwise create a fresh MCP
session for each invocation, losing Stagehand's browser state.

## Run a Deep Agent

```bash
STAGEHAND_SANDBOX_ARTIFACTS="$PWD/packages/integrations/examples/vercel-sandbox/.artifacts" \
BROWSERBASE_API_KEY=<api-key> \
BROWSERBASE_PROJECT_ID=<project-id> \
VERCEL_OIDC_TOKEN=<oidc-token> \
OPENAI_API_KEY=<openai-key> \
python packages/integrations/examples/langchain/agent.py \
  "Open https://example.com and return its title and URL."
```

The lease subprocess receives only Browserbase, Vercel, artifact, and runtime variables from its
allowlist. Outer model-provider credentials are intentionally excluded, and the sandbox foundation
brokers the Browserbase credential at its egress boundary.
