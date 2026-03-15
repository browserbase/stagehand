import { randomUUID } from "node:crypto";
import type { BrowserSession } from "../browser/session.js";
import type {
  AgentHarnessOptions,
  AgentMessage,
  AgentTurnResult,
  NamedStdioLaunchConfig,
} from "../types.js";
import { MCPServer } from "../mcp/server.js";
import { createAgentHarness } from "./registry.js";

export interface AgentSessionOptions {
  harness: AgentHarnessOptions;
  browserSession: BrowserSession;
  cwd: string;
}

export class AgentSession {
  readonly id = randomUUID();
  private readonly harness;
  private readonly messages: AgentMessage[] = [];
  private readonly mcpServers: MCPServer[] = [];

  constructor(private readonly options: AgentSessionOptions) {
    this.harness = createAgentHarness(
      options.harness,
      options.browserSession,
    );
  }

  async start(): Promise<void> {
    await this.harness.start();
  }

  async stop(): Promise<void> {
    await this.harness.stop();
  }

  attachMCPServer(server: MCPServer): void {
    this.mcpServers.push(server);
  }

  getMessages(): AgentMessage[] {
    return [...this.messages];
  }

  private async getNamedLaunchConfigs(): Promise<NamedStdioLaunchConfig[]> {
    return await Promise.all(
      this.mcpServers.map(async (server) => ({
        name: server.getName(),
        config: await server.getLaunchConfig(),
      })),
    );
  }

  async addUserMessage(content: string): Promise<AgentTurnResult> {
    const userMessage: AgentMessage = {
      id: randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    this.messages.push(userMessage);

    const result = await this.harness.runTurn({
      prompt: content,
      mcpServers: await this.getNamedLaunchConfigs(),
      cwd: this.options.cwd,
    });

    const assistantMessage: AgentMessage = {
      id: randomUUID(),
      role: "assistant",
      content: result.content,
      createdAt: new Date().toISOString(),
      raw: result.raw,
    };
    this.messages.push(assistantMessage);

    return {
      sessionId: result.sessionId,
      message: assistantMessage,
      raw: result.raw,
      usage: result.usage,
    };
  }
}
