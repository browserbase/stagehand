import {
  Client,
  ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  type StreamableHTTPClientTransportOptions,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPConnectionError } from "../types/public/sdkErrors.js";

export interface ConnectToMCPServerOptions {
  serverUrl: string | URL;
  clientOptions?: ClientOptions;
  requestOptions?: StreamableHTTPClientTransportOptions;
}

export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export const connectToMCPServer = async (
  serverConfig: string | URL | StdioServerConfig | ConnectToMCPServerOptions,
): Promise<Client> => {
  try {
    let transport;
    let clientOptions: ClientOptions | undefined;
    let requestOptions: StreamableHTTPClientTransportOptions | undefined;

    // Check if it's a stdio config (has 'command' property)
    if (typeof serverConfig === "object" && "command" in serverConfig) {
      transport = new StdioClientTransport(serverConfig);
    } else {
      // Handle URL-based connection
      let serverUrl: string | URL;

      if (typeof serverConfig === "string" || serverConfig instanceof URL) {
        serverUrl = serverConfig;
      } else {
        serverUrl = (serverConfig as ConnectToMCPServerOptions).serverUrl;
        clientOptions = (serverConfig as ConnectToMCPServerOptions)
          .clientOptions;
        requestOptions = (serverConfig as ConnectToMCPServerOptions)
          .requestOptions;
      }

      transport = new StreamableHTTPClientTransport(
        new URL(serverUrl),
        requestOptions,
      );
    }

    const client = new Client({
      name: "Stagehand",
      version: "1.0.0",
      ...clientOptions,
    });

    await client.connect(transport);

    try {
      await client.ping();
    } catch (pingError) {
      await client.close();
      throw new MCPConnectionError(serverConfig.toString(), pingError);
    }

    return client;
  } catch (error) {
    // Handle any errors during transport/client creation or connection
    if (error instanceof MCPConnectionError) {
      throw error; // Re-throw our custom error
    }
    throw new MCPConnectionError(serverConfig.toString(), error);
  }
};
