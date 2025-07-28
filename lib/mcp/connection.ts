import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  Client,
  ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import { MCPConnectionError } from "../../types/stagehandErrors";

export interface ConnectToMCPServerOptions {
  serverUrl: string | URL;
  clientOptions?: ClientOptions;
}

export const connectToMCPServer = async (
  serverUrlOrOptions: string | ConnectToMCPServerOptions,
): Promise<Client & { serverUrl?: string }> => {
  // Handle both string URL and options object
  const options: ConnectToMCPServerOptions =
    typeof serverUrlOrOptions === "string"
      ? { serverUrl: serverUrlOrOptions }
      : serverUrlOrOptions;

  const serverUrl = options.serverUrl.toString();

  try {
    const transport = new StreamableHTTPClientTransport(
      new URL(options.serverUrl),
    );
    const client = new Client({
      name: "Stagehand",
      version: "1.0.0",
      ...options.clientOptions,
    });

    await client.connect(transport);

    try {
      await client.ping();
    } catch (pingError) {
      await client.close();
      throw new MCPConnectionError(serverUrl, pingError);
    }

    // Add serverUrl property to the client object
    (client as Client & { serverUrl: string }).serverUrl = serverUrl;
    return client as Client & { serverUrl: string };
  } catch (error) {
    // Handle any errors during transport/client creation or connection
    if (error instanceof MCPConnectionError) {
      throw error; // Re-throw our custom error
    }
    throw new MCPConnectionError(serverUrl, error);
  }
};
