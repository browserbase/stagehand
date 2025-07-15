import { MCPClient } from "mcp-client";

export const createMCPConnection = async (url: string): Promise<MCPClient> => {
  const client = new MCPClient({});

  await client.connect({
    type: "sse",
    url,
  });

  try {
    await client.ping();
  } catch (error) {
    await client.close();
    throw error;
  }

  return client;
};
