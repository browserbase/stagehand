import { fileURLToPath } from "node:url";

import { Agent } from "@mastra/core/agent";
import { MCPClient } from "@mastra/mcp";

const DEFAULT_STDIO_SERVER_PATH = fileURLToPath(
  new URL("../../../dist/codemode/stdio-server.mjs", import.meta.url),
);

export function createStagehandMcpClient(stdioServerPath = DEFAULT_STDIO_SERVER_PATH): MCPClient {
  return new MCPClient({
    id: "stagehand-codemode",
    servers: {
      stagehand: {
        command: process.execPath,
        args: [stdioServerPath],
        env: definedEnvironment(process.env),
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
  close: () => Promise<void>;
};

export async function createStagehandAgent(
  model = process.env.MASTRA_MODEL ?? "openai/gpt-5-mini",
): Promise<StagehandAgentHandle> {
  const mcp = createStagehandMcpClient();

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
      close: () => mcp.disconnect(),
    };
  } catch (error) {
    await mcp.disconnect().catch(() => undefined);
    throw error;
  }
}

export async function runStagehandAgent(prompt: string, model?: string): Promise<string> {
  const handle = await createStagehandAgent(model);

  try {
    const result = await handle.agent.generate(prompt, { maxSteps: 8 });
    return result.text;
  } finally {
    await handle.close();
  }
}

function definedEnvironment(environment: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}

function formatErrors(errors: Record<string, unknown>): string {
  return Object.entries(errors)
    .map(
      ([server, error]) => `${server}: ${error instanceof Error ? error.message : String(error)}`,
    )
    .join("; ");
}
