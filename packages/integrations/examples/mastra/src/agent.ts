import { Agent } from "@mastra/core/agent";
import { MCPClient } from "@mastra/mcp";
import type { StagehandSandboxConnection } from "@browserbasehq/stagehand-integrations-example-vercel-sandbox";

type RemoteStagehandConnection = Pick<StagehandSandboxConnection, "url" | "token">;

export function createStagehandMcpClient(connection: RemoteStagehandConnection): MCPClient {
  return new MCPClient({
    id: "stagehand-codemode",
    servers: {
      stagehand: {
        url: connection.url,
        fetch: async (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${connection.token}`);
          return fetch(input, { ...init, headers });
        },
      },
    },
  });
}

export async function loadStagehandCodeTools(mcp: MCPClient) {
  const { toolsets, errors } = await mcp.listToolsetsWithErrors();
  if (Object.keys(errors).length > 0) {
    throw new Error(`Could not load the Stagehand MCP tools: ${formatErrors(errors)}`);
  }

  const stagehandTools = toolsets.stagehand ?? {};
  const toolNames = Object.keys(stagehandTools);
  if (toolNames.length !== 1 || toolNames[0] !== "code_execute") {
    throw new Error(
      `Expected exactly the code_execute tool, received: ${toolNames.join(", ") || "none"}`,
    );
  }

  const codeExecute = stagehandTools.code_execute;
  if (!codeExecute) {
    throw new Error("The Stagehand MCP server did not provide code_execute");
  }

  const guidance = codeExecute.description?.trim();
  if (!guidance?.includes("# Stagehand V4 code-mode syntax")) {
    throw new Error("code_execute did not include the canonical Stagehand code-mode guidance");
  }

  return { code_execute: codeExecute };
}

export type StagehandCodeTools = Awaited<ReturnType<typeof loadStagehandCodeTools>>;

export type StagehandAgentHandle = {
  agent: Agent;
  tools: StagehandCodeTools;
  close: () => Promise<void>;
};

export async function createStagehandAgent(
  connection: RemoteStagehandConnection,
  model = process.env.MASTRA_MODEL ?? "openai/gpt-5-mini",
): Promise<StagehandAgentHandle> {
  const mcp = createStagehandMcpClient(connection);

  try {
    const tools = await loadStagehandCodeTools(mcp);
    const instructions = tools.code_execute.description;
    if (!instructions) {
      throw new Error("code_execute did not provide agent guidance");
    }

    const agent = new Agent({
      id: "stagehand-browser-agent",
      name: "Stagehand browser agent",
      instructions,
      model,
      tools,
    });

    return {
      agent,
      tools,
      close: () => mcp.disconnect(),
    };
  } catch (error) {
    await mcp.disconnect().catch(() => undefined);
    throw error;
  }
}

export async function runStagehandAgent(
  connection: RemoteStagehandConnection,
  prompt: string,
  model?: string,
): Promise<string> {
  const handle = await createStagehandAgent(connection, model);

  try {
    const result = await handle.agent.generate(prompt, { maxSteps: 8 });
    return result.text;
  } finally {
    await handle.close();
  }
}

function formatErrors(errors: Record<string, unknown>): string {
  return Object.entries(errors)
    .map(
      ([server, error]) => `${server}: ${error instanceof Error ? error.message : String(error)}`,
    )
    .join("; ");
}
