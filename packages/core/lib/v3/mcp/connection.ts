import {
  Client,
  ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { MCPConnectionError } from "../types/public/sdkErrors";
import {
  WebMCPTransport,
  WebMCPTransportOptions,
} from "./webmcpTransport";
import type { CDPSessionLike } from "../understudy/cdp";

export interface ConnectToMCPServerOptions {
  serverUrl: string | URL;
  clientOptions?: ClientOptions;
}

export interface StdioServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface ConnectToWebMCPOptions extends WebMCPTransportOptions {
  clientOptions?: ClientOptions;
}

export const connectToMCPServer = async (
  serverConfig: string | URL | StdioServerConfig | ConnectToMCPServerOptions,
): Promise<Client> => {
  try {
    let transport;
    let clientOptions: ClientOptions | undefined;

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
      }

      transport = new StreamableHTTPClientTransport(new URL(serverUrl));
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

/**
 * Connects to a WebMCP server running inside a browser page.
 *
 * Uses CDP (Runtime.addBinding + Runtime.evaluate) to bridge JSON-RPC
 * messages between a Node.js MCP Client and the page's WebMCP
 * TabServerTransport, which communicates via window.postMessage.
 *
 * The returned Client can be passed directly to `stagehand.agent({ integrations: [client] })`.
 *
 * @param session - The CDP session for the page containing the WebMCP server
 * @param options - Optional configuration (ready timeout, client options)
 */
export const connectToWebMCP = async (
  session: CDPSessionLike,
  options?: ConnectToWebMCPOptions,
): Promise<Client> => {
  try {
    const transport = new WebMCPTransport(session, options);

    const client = new Client({
      name: "Stagehand-WebMCP",
      version: "1.0.0",
      ...options?.clientOptions,
    });

    await client.connect(transport);

    try {
      await client.ping();
    } catch (pingError) {
      await client.close();
      throw new MCPConnectionError("webmcp://page", pingError);
    }

    return client;
  } catch (error) {
    if (error instanceof MCPConnectionError) {
      throw error;
    }
    throw new MCPConnectionError("webmcp://page", error);
  }
};
