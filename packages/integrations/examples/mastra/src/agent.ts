import { Agent } from "@mastra/core/agent";
import { MCPClient } from "@mastra/mcp";
import type { StagehandSandboxConnection } from "@browserbasehq/stagehand-integrations-example-vercel-sandbox";

type RemoteStagehandConnection = Pick<StagehandSandboxConnection, "url" | "token">;

export class StagehandMastraSetupError extends Error {
  override readonly name = "StagehandMastraSetupError";

  constructor() {
    super("Could not configure the Mastra Stagehand agent.");
  }
}

export class StagehandMastraToolContractError extends Error {
  override readonly name = "StagehandMastraToolContractError";

  constructor() {
    super("The Stagehand MCP server returned an invalid tool contract.");
  }
}

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
  let discovery: Awaited<ReturnType<MCPClient["listToolsetsWithErrors"]>>;
  try {
    discovery = await mcp.listToolsetsWithErrors();
  } catch {
    throw new StagehandMastraSetupError();
  }
  const { toolsets, errors } = discovery;
  if (Object.keys(errors).length > 0) {
    throw new StagehandMastraSetupError();
  }

  const stagehandTools = toolsets.stagehand ?? {};
  const toolNames = Object.keys(stagehandTools);
  if (toolNames.length !== 1 || toolNames[0] !== "code_execute") {
    throw new StagehandMastraToolContractError();
  }

  const codeExecute = stagehandTools.code_execute;
  if (!codeExecute) {
    throw new StagehandMastraToolContractError();
  }

  const guidance = codeExecute.description?.trim();
  if (!guidance?.includes("# Stagehand V4 code-mode syntax")) {
    throw new StagehandMastraToolContractError();
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
      throw new StagehandMastraToolContractError();
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
    if (
      error instanceof StagehandMastraSetupError ||
      error instanceof StagehandMastraToolContractError
    ) {
      throw error;
    }
    throw new StagehandMastraSetupError();
  }
}
