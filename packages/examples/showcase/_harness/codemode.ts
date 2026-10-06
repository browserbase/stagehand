import { fileURLToPath } from "node:url";
import { createMCPClient } from "@ai-sdk/mcp";
import Browserbase from "@browserbasehq/sdk";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import {
  SESSION_INFO_TOOL_NAME,
  facadeAgentInstructions,
} from "@browserbasehq/stagehand-integrations/facade";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import type { z } from "zod/v4";
import { runAgent, type AgentRun } from "./agent.ts";
import { requireEnv } from "./session.ts";
import type { ShowcaseTask, Workflow } from "./task.ts";

// The same agent loop as the baseline, pointed at Stagehand's code-mode facade:
// the model writes Playwright-shaped code that Stagehand runs in one browser.
export async function runCodeMode<Schema extends z.ZodType>(
  workflow: Workflow<Schema>,
  task: ShowcaseTask<Schema>,
): Promise<AgentRun & { sessionId: string | undefined }> {
  const env = requireEnv();
  const client = await createMCPClient({
    clientName: "stagehand-showcase-code-mode",
    transport: new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [
        fileURLToPath(
          import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
        ),
      ],
      env: {
        ...buildAllowlistedEnv(),
        STAGEHAND_BROWSER: "browserbase",
        BROWSERBASE_API_KEY: env.BROWSERBASE_API_KEY,
        STAGEHAND_BROWSERBASE_PROXIES: String(task.proxies ?? false),
        // Matches the other lanes; the facade defaults to an hour.
        STAGEHAND_BROWSERBASE_SESSION_TIMEOUT_SECONDS: "900",
      },
    }),
  });
  let sessionId: string | undefined;
  try {
    // Launches the session before the agent starts so its recording is known.
    const info = (await client.callTool({ name: SESSION_INFO_TOOL_NAME, arguments: {} })) as {
      content?: Array<{ type: string; text?: string }>;
    };
    const text = info.content?.find((part) => part.type === "text")?.text ?? "{}";
    ({ sessionId } = JSON.parse(text) as { sessionId?: string });
    return { ...(await runAgent(workflow, task, client, facadeAgentInstructions())), sessionId };
  } finally {
    await client.close();
    // The facade does not always release its session on close.
    if (sessionId) {
      await new Browserbase({ apiKey: env.BROWSERBASE_API_KEY }).sessions
        .update(sessionId, { status: "REQUEST_RELEASE" })
        .catch(() => undefined);
    }
  }
}
