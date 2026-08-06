import { fileURLToPath } from "node:url";
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { STAGEHAND_CODEMODE_SKILL } from "@browserbasehq/stagehand-integrations/codemode";
import { generateText, stepCountIs, type LanguageModel } from "ai";

const DEFAULT_STDIO_SERVER_PATH = fileURLToPath(
  new URL("../../../dist/codemode/stdio-server.mjs", import.meta.url),
);

export type StagehandMcpBinding = {
  client: MCPClient;
  tools: Awaited<ReturnType<MCPClient["tools"]>>;
};

export type StagehandAgentResult = {
  text: string;
  toolNames: string[];
};

export async function createStagehandMcpBinding(
  stdioServerPath = DEFAULT_STDIO_SERVER_PATH,
): Promise<StagehandMcpBinding> {
  const client = await createMCPClient({
    transport: new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [stdioServerPath],
      env: definedEnvironment(),
    }),
  });

  return {
    client,
    tools: await client.tools(),
  };
}

export async function runStagehandAgent(
  model: LanguageModel,
  prompt: string,
): Promise<StagehandAgentResult> {
  const { client, tools } = await createStagehandMcpBinding();
  try {
    const result = await generateText({
      model,
      system: STAGEHAND_CODEMODE_SKILL,
      prompt,
      tools,
      stopWhen: stepCountIs(8),
    });
    return {
      text: result.text,
      toolNames: result.steps.flatMap((step) => step.toolCalls.map((call) => call.toolName)),
    };
  } finally {
    await client.close();
  }
}

function definedEnvironment(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );
}
