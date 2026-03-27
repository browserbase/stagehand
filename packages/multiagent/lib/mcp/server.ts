import { randomUUID } from "node:crypto";
import {
  Client,
  type ClientOptions,
} from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { BrowserSession } from "../browser/session.js";
import type {
  MCPServerOptions,
  StdioLaunchConfig,
} from "../types.js";
import { MultiagentError } from "../utils/errors.js";
import { getMCPServerAdapter } from "./registry.js";

export class MCPServer {
  readonly id = randomUUID();
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;

  constructor(
    private readonly options: MCPServerOptions,
    private readonly browserSession?: BrowserSession,
  ) {}

  getName(): string {
    return this.options.name ?? this.options.type;
  }

  async getLaunchConfig(): Promise<StdioLaunchConfig> {
    const adapter = getMCPServerAdapter(this.options.type);
    return await adapter.getLaunchConfig({
      browserSession: this.browserSession,
      options: this.options,
    });
  }

  async start(clientOptions?: ClientOptions): Promise<void> {
    if (this.client) {
      return;
    }

    const launchConfig = await this.getLaunchConfig();
    this.transport = new StdioClientTransport({
      command: launchConfig.command,
      args: launchConfig.args,
      env: {
        ...process.env,
        ...(launchConfig.env ?? {}),
      },
      cwd: launchConfig.cwd,
    });

    this.client = new Client({
      name: "multiagent",
      version: "0.1.0",
      ...clientOptions,
    });
    await this.client.connect(this.transport);
    await this.client.ping();
  }

  async stop(): Promise<void> {
    await this.client?.close();
    await this.transport?.close();
    this.client = null;
    this.transport = null;
  }

  getClient(): Client | null {
    return this.client;
  }

  async listTools(): Promise<
    Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }>
  > {
    if (!this.client) {
      throw new MultiagentError(
        `MCP server ${this.getName()} is not started yet.`,
      );
    }

    const tools: Array<{
      name: string;
      description?: string;
      inputSchema?: unknown;
    }> = [];
    let cursor: string | undefined;

    do {
      const page = await this.client.listTools({ cursor });
      tools.push(
        ...page.tools.map((tool) => ({
          name: tool.name ?? "unknown",
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      );
      cursor = page.nextCursor;
    } while (cursor);

    return tools;
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.client) {
      throw new MultiagentError(
        `MCP server ${this.getName()} is not started yet.`,
      );
    }

    return await this.client.callTool({
      name,
      arguments: args,
    });
  }
}
