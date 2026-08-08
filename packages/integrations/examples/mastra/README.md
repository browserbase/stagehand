# Mastra with Stagehand code mode

This example gives a Mastra agent one browser tool: `code_execute`. The Stagehand code-mode MCP
server runs inside the package-installed [Vercel Sandbox example](../vercel-sandbox); Mastra connects
to its authenticated Streamable HTTP endpoint and keeps one MCP client and browser session alive for
the agent handle's lifetime.

The agent instructions come directly from the MCP tool description. The adapter does not copy the
Stagehand executor, schema, or code-mode skill, so the agent and the tool cannot drift onto different
browser APIs.

## Run the end-to-end proof

From the repository root, install dependencies, build and pack the exact Stagehand artifacts, then
run the Mastra proof:

```bash
pnpm install
pnpm exec turbo run build --filter @browserbasehq/stagehand-codemode
pnpm --filter @browserbasehq/stagehand-integrations-example-vercel-sandbox pack:artifacts
STAGEHAND_SANDBOX_ARTIFACTS="$PWD/packages/integrations/examples/vercel-sandbox/.artifacts" \
BROWSERBASE_API_KEY=<api-key> \
BROWSERBASE_PROJECT_ID=<project-id> \
VERCEL_OIDC_TOKEN=<oidc-token> \
OPENAI_API_KEY=<openai-key> \
pnpm --dir packages/integrations/examples/mastra e2e
```

For local Vercel credentials, replace `VERCEL_OIDC_TOKEN` with `VERCEL_TEAM_ID`,
`VERCEL_PROJECT_ID`, and `VERCEL_TOKEN`.

The proof exercises one live package-installed sandbox and one persistent Mastra MCP client. It:

1. invokes `code_execute` twice directly and verifies the same page ID and DOM marker;
2. makes a real Mastra model select `code_execute` and modify that existing page;
3. invokes the tool again to independently verify the model's browser-side change;
4. proves `OPENAI_API_KEY` and a host-only marker never enter model-generated code; and
5. disconnects Mastra before stopping and deleting the sandbox, emitting `PASS` only after cleanup.

Set `MASTRA_MODEL` to use a model other than `openai/gpt-5-mini`.

## Use the agent

```ts
import { createStagehandSandbox } from "@browserbasehq/stagehand-integrations-example-vercel-sandbox";

import { createStagehandAgent } from "./src/agent.js";

const connection = await createStagehandSandbox({
  packageArtifactsPath: process.env.STAGEHAND_SANDBOX_ARTIFACTS!,
  browserbaseApiKey: process.env.BROWSERBASE_API_KEY!,
  browserbaseProjectId: process.env.BROWSERBASE_PROJECT_ID!,
});
const stagehand = await createStagehandAgent(connection);

try {
  const response = await stagehand.agent.generate("Open example.com and return the page heading.", {
    maxSteps: 8,
  });
  console.log(response.text);
} finally {
  await stagehand.close();
  await connection.close();
}
```

The outer application owns the sandbox connection. Disconnect the Mastra MCP client before closing
that connection so the HTTP transport can finish cleanly.
