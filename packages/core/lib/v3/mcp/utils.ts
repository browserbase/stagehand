import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ToolSet } from "ai";
import { JsonSchema, jsonSchemaToZod } from "../../utils.js";
import type { Page } from "../understudy/page.js";
import { connectToMCPServer } from "./connection.js";

export interface ListedMCPTool {
  name: string;
  description?: string;
  inputSchema?: JsonSchema;
}

export interface ListedWebMCPTool extends ListedMCPTool {
  frameId: string;
  annotations?: Record<string, unknown>;
}

type WebMCPCdpTool = {
  name?: unknown;
  description?: unknown;
  inputSchema?: unknown;
  annotations?: unknown;
  frameId?: unknown;
};

const normalizeTool = (tool: WebMCPCdpTool): ListedWebMCPTool | null => {
  if (
    typeof tool.name !== "string" ||
    tool.name.length === 0 ||
    typeof tool.frameId !== "string"
  ) {
    return null;
  }

  let inputSchema: JsonSchema | undefined;
  if (typeof tool.inputSchema === "string") {
    try {
      inputSchema = JSON.parse(tool.inputSchema) as JsonSchema;
    } catch {
      inputSchema = undefined;
    }
  } else if (tool.inputSchema && typeof tool.inputSchema === "object") {
    inputSchema = tool.inputSchema as JsonSchema;
  }

  return {
    name: tool.name,
    ...(typeof tool.description === "string" && {
      description: tool.description,
    }),
    ...(inputSchema && { inputSchema }),
    ...(tool.annotations &&
      typeof tool.annotations === "object" && {
        annotations: tool.annotations as Record<string, unknown>,
      }),
    frameId: tool.frameId,
  };
};

const normalizeWebMCPTools = (tools: unknown): ListedWebMCPTool[] => {
  if (!Array.isArray(tools)) {
    return [];
  }

  return tools
    .map((tool) =>
      tool && typeof tool === "object"
        ? normalizeTool(tool as WebMCPCdpTool)
        : null,
    )
    .filter((tool): tool is ListedWebMCPTool => tool !== null);
};

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

export const listMCPTools = async (
  clients: (Client | string)[],
): Promise<ListedMCPTool[]> => {
  const tools: ListedMCPTool[] = [];

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
        tools.push({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema as JsonSchema,
        });
      }
      nextCursor = clientTools.nextCursor;
    } while (nextCursor);
  }

  return tools;
};

export const listWebMCPTools = async (
  page: Page,
): Promise<ListedWebMCPTool[]> => {
  return normalizeWebMCPTools(await page.listWebMCPTools());
};
