import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { createMcpConnection } from "@flue/runtime";

export interface FlueMcpServer {
  tools: Tool[];
  callTool(
    name: string,
    args: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<CallToolResult>;
}

/** Flue's native MCP adapter takes HTTP. Route its fetches in-process to the
 * existing stdio connection, retaining wire schemas and MCP error semantics.
 * No socket is opened and no schema translation is needed. */
export async function bridgeFlueMcpTools(name: string, connection: FlueMcpServer) {
  const server = new Server(
    { name: "stagehand-flue-bridge", version: "1.0.0" },
    { capabilities: { tools: {} } },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: randomUUID,
    enableJsonResponse: true,
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: connection.tools,
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) =>
    connection.callTool(
      request.params.name,
      request.params.arguments ?? {},
      extra.signal,
    ),
  );
  try {
    await server.connect(transport);
    const native = await createMcpConnection({
      name,
      url: "http://localhost/mcp",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        // This bridge has no unsolicited notifications or SSE stream.
        if (request.method === "GET") return new Response(null, { status: 405 });
        return transport.handleRequest(request);
      },
    });
    return {
      tools: native.tools,
      async close() {
        try {
          await native.close();
        } finally {
          await server.close();
        }
      },
    };
  } catch (error) {
    await server.close().catch((): undefined => undefined);
    throw error;
  }
}
