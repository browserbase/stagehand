import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import Browserbase from "@browserbasehq/sdk";
import type { z } from "zod/v4";
import { runAgent, type AgentRun } from "./agent.ts";
import { requireEnv, sessionSettings } from "./session.ts";
import type { ShowcaseTask, Workflow } from "./task.ts";

const INSTRUCTIONS = "You control a real browser through Playwright MCP tools.";

function playwrightMcpCli(): string {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve("@playwright/mcp/package.json")), "cli.js");
}

// The baseline is an LLM agent driving the stock Playwright MCP server over
// CDP, on the same model and the same kind of Browserbase session as Stagehand.
export async function runPlaywrightMcp<Schema extends z.ZodType>(
  workflow: Workflow<Schema>,
  task: ShowcaseTask<Schema>,
): Promise<AgentRun & { sessionId: string }> {
  const bb = new Browserbase({ apiKey: requireEnv().BROWSERBASE_API_KEY });
  const session = await bb.sessions.create(sessionSettings(task));
  const client = await createMCPClient({
    clientName: "stagehand-showcase-playwright-mcp",
    transport: new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [playwrightMcpCli(), "--cdp-endpoint", session.connectUrl],
    }),
  });
  try {
    return { ...(await runAgent(workflow, task, client, INSTRUCTIONS)), sessionId: session.id };
  } finally {
    await client.close();
    await bb.sessions.update(session.id, { status: "REQUEST_RELEASE" }).catch(() => undefined);
  }
}
