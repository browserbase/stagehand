# Vercel AI SDK + Stagehand code mode

This example connects the Vercel AI SDK to the workspace's canonical Stagehand code-mode MCP server
over stdio. One MCP client remains open for the complete `generateText` call, so repeated
`code_execute` calls share the same browser context.

The MCP child reads the normal code-mode startup environment. Set `STAGEHAND_BROWSER=local` for a
local headless browser or `STAGEHAND_BROWSER=browserbase` with Browserbase credentials for a remote
browser.

```bash
pnpm --filter @browserbasehq/stagehand-integrations build
STAGEHAND_BROWSER=local pnpm --filter @browserbasehq/stagehand-integrations-example-vercel smoke
```

See [`src/agent.ts`](./src/agent.ts) for the reusable connection lifecycle and
[`src/e2e.ts`](./src/e2e.ts) for a real model-driven example.
