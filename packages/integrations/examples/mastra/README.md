# Mastra with Stagehand code mode

This example gives a Mastra agent one browser tool: `code_execute`. It launches the canonical
Stagehand code-mode MCP server from this repository over stdio, keeps that process and its browser
session alive for the lifetime of the agent handle, and disconnects it during cleanup.

The agent instructions come directly from the MCP tool description. The example intentionally does
not copy the Stagehand executor, schema, or code-mode skill, so the agent and the tool cannot drift
onto different browser APIs.

## Run the smoke test

From the repository root, install dependencies, build the integration package, and run the smoke:

```bash
pnpm install
pnpm --filter @browserbasehq/stagehand-extension build
pnpm --filter @browserbasehq/stagehand build
pnpm --filter @browserbasehq/stagehand-integrations build
STAGEHAND_BROWSER=local pnpm --dir packages/integrations/examples/mastra smoke
```

The smoke opens a real local browser and invokes the Mastra MCP tool twice. The first call writes a
marker into the page; the second reads it back. Seeing the same marker proves that both calls used
the same MCP process and browser session. The final output also confirms that the MCP client
disconnected cleanly.

To use a Browserbase browser instead, inherit the normal Stagehand environment variables:

```bash
STAGEHAND_BROWSER=browserbase \
BROWSERBASE_API_KEY=<api-key> \
BROWSERBASE_PROJECT_ID=<project-id> \
pnpm --dir packages/integrations/examples/mastra smoke
```

## Use the agent

```ts
import { createStagehandAgent } from "./src/agent.js";

const stagehand = await createStagehandAgent();

try {
  const response = await stagehand.agent.generate("Open example.com and return the page heading.", {
    maxSteps: 8,
  });
  console.log(response.text);
} finally {
  await stagehand.close();
}
```

Set `MASTRA_MODEL` to choose a different Mastra model. `createStagehandMcpClient()` forwards the
current process environment to the stdio server, including `STAGEHAND_BROWSER`,
`BROWSERBASE_API_KEY`, and `BROWSERBASE_PROJECT_ID`.
