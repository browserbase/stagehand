import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";

export const createMCPConnection = async (url: string): Promise<Client> => {
  const transport = new StreamableHTTPClientTransport(new URL(url));
  const client = new Client({
    name: "Stagehand",
    version: "1.0.0",
  });
  console.log("Attempting to connect to MCP server");
  await client.connect(transport);

  try {
    await client.ping();
    console.log("MCP connection successful");
  } catch (error) {
    await client.close();
    throw new Error(`MCP connection failed: ${error}`);
  }

  return client;
};
