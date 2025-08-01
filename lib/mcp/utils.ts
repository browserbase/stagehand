import { Client } from "@modelcontextprotocol/sdk/dist/esm/client";
import { ToolSet } from "ai/dist";
import { JsonSchema, jsonSchemaToZod } from "../utils";
import { MCPToolAlreadyDefinedError } from "@/types/stagehandErrors";
import { connectToMCPServer } from "./connection";

export const resolveTools = async (
  clients: (Client | string)[],
  userTools: ToolSet,
): Promise<ToolSet> => {
  const tools: ToolSet = { ...userTools };

  for (let client of clients) {
    if (typeof client === "string") {
      client = await connectToMCPServer(client);
    }
    let nextCursor: string | undefined = undefined;
    do {
      const clientTools = await client.listTools({
        cursor: nextCursor,
      });

      for (const tool of clientTools.tools) {
        if (tools[tool.name]) {
          throw new MCPToolAlreadyDefinedError(tool.name);
        }
        tools[tool.name] = {
          description: tool.description,
          parameters: jsonSchemaToZod(tool.inputSchema as JsonSchema),
          execute: async (input) => {
            console.log("Calling tool", tool.name, input);
            const result = await client.callTool({
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
