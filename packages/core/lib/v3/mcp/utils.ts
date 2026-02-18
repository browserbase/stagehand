import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolSet } from "ai";
import { JsonSchema, jsonSchemaToZod } from "../../utils.js";
import { connectToMCPServer } from "./connection.js";

export const resolveTools = async (
  clients: (Client | string)[],
  userTools: ToolSet,
): Promise<ToolSet> => {
  const tools: ToolSet = { ...userTools };

  for (const client of clients) {
    let clientInstance: Client;
    if (typeof client === "string") {
      clientInstance = await connectToMCPServer(client);
    } else {
      clientInstance = client;
    }

    let nextCursor: string | undefined = undefined;

    do {
      const clientTools = await clientInstance.listTools({
        cursor: nextCursor,
      });

      for (const tool of clientTools.tools) {
        tools[tool.name] = {
          description: tool.description,
          inputSchema: jsonSchemaToZod(tool.inputSchema as JsonSchema),
          execute: async (input) => {
            const result = await clientInstance.callTool({
              name: tool.name,
              arguments: input,
            });
            return result;
          },
        };
      }
      nextCursor = clientTools.nextCursor;
    } while (nextCursor);
  }

  return tools;
};
