import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import { StagehandCodeExecutor, type StagehandCodeExecutorOptions } from "./executor.js";
import {
  CODE_EXECUTE_DESCRIPTION,
  codeExecuteResultText,
  codeExecuteSchema,
} from "./tool-contract.js";
import type { CodeExecuteInput, CodeExecuteResult } from "./types.js";

export function createCodeModeMcpServer(executor: StagehandCodeExecutor): McpServer {
  const server = new McpServer({
    name: "stagehand-codemode",
    version: "4.0.0",
  });
  server.registerTool(
    "code_execute",
    {
      title: "Execute Stagehand V4 code",
      description: CODE_EXECUTE_DESCRIPTION,
      inputSchema: codeExecuteSchema.shape,
      outputSchema: z.object({ ok: z.boolean() }).loose(),
    },
    async (input, extra) => {
      const result = await executor.execute(input as CodeExecuteInput, extra.signal);
      return mcpResult(result);
    },
  );
  return server;
}

export async function connectCodeModeStdio(executor: StagehandCodeExecutor): Promise<McpServer> {
  const server = createCodeModeMcpServer(executor);
  await server.connect(new StdioServerTransport());
  return server;
}

export function createCodeModeMcp(options: StagehandCodeExecutorOptions): {
  executor: StagehandCodeExecutor;
  server: McpServer;
} {
  const executor = new StagehandCodeExecutor(options);
  return { executor, server: createCodeModeMcpServer(executor) };
}

function mcpResult(result: CodeExecuteResult) {
  return {
    content: [{ type: "text" as const, text: codeExecuteResultText(result) }],
    structuredContent: result as unknown as Record<string, unknown>,
    isError: !result.ok,
  };
}
