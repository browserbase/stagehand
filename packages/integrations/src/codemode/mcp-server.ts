import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StagehandCodeExecutor, type StagehandCodeExecutorOptions } from "./executor.js";
import * as codeModeMcpRuntime from "./mcp-runtime.js";
import {
  CODE_EXECUTE_DESCRIPTION,
  codeExecuteOutputSchema,
  codeExecuteResultText,
  codeExecuteSchema,
} from "./tool-contract.js";
import type { CodeExecuteInput, CodeExecuteResult } from "./types.js";

export function createCodeModeMcpServer(executor: StagehandCodeExecutor): McpServer {
  const server = codeModeMcpRuntime.createCodeModeMcpHost();
  server.registerTool(
    "code_execute",
    {
      title: "Execute Stagehand V4 code",
      description: CODE_EXECUTE_DESCRIPTION,
      inputSchema: codeExecuteSchema.shape,
      outputSchema: codeExecuteOutputSchema,
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
  await codeModeMcpRuntime.connectCodeModeStdio(server);
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
