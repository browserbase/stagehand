import { Client } from "@modelcontextprotocol/sdk/dist/esm/client";
import { ToolSet } from "ai/dist";
import { JsonSchema, jsonSchemaToZod } from "../utils";

export const resolveTools = async (
  clients: Client[],
  userTools: ToolSet,
): Promise<ToolSet> => {
  const tools: ToolSet = { ...userTools };

  for (const client of clients) {
    let nextCursor: string | undefined = undefined;
    do {
      const clientTools = await client.listTools({
        cursor: nextCursor,
      });

      for (const tool of clientTools.tools) {
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
