import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

export function createCodeModeMcpHost(): McpServer {
  return new McpServer({
    name: "stagehand-codemode",
    version: "4.0.0",
  });
}

export async function connectCodeModeStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
}
