import { AgentSession } from "../agents/session.js";
import { BrowserSession } from "../browser/session.js";
import { createMCPServer } from "../mcp/index.js";
import type {
  MultiAgentRunOptions,
  MultiAgentRunResult,
} from "../types.js";

export class MultiAgentDriver {
  constructor(private readonly options: MultiAgentRunOptions) {}

  async run(): Promise<MultiAgentRunResult> {
    const cwd = this.options.cwd ?? process.cwd();
    const browserSession = new BrowserSession(this.options.browser);
    await browserSession.start();

    const mcpServers = (this.options.mcpServers ?? [])
      .filter((server) => server.enabled !== false)
      .map((server) => createMCPServer(server, browserSession));

    const agentSessions = this.options.agents.map((harness) => {
      const session = new AgentSession({
        harness,
        browserSession,
        cwd,
      });
      for (const server of mcpServers) {
        session.attachMCPServer(server);
      }
      return session;
    });

    try {
      await Promise.all(agentSessions.map(async (session) => await session.start()));

      const agentResults = await Promise.all(
        agentSessions.map(async (session, index) => {
          const harness = this.options.agents[index];

          try {
            const turn = await session.addUserMessage(this.options.task);
            return {
              harness: harness.type,
              sessionId: turn.sessionId,
              content: turn.message.content,
              raw: turn.raw,
              usage: turn.usage,
            };
          } catch (error) {
            return {
              harness: harness.type,
              content: "",
              error: error instanceof Error ? error.message : String(error),
              raw: error,
            };
          }
        }),
      );

      return {
        browser: browserSession.getMetadata(),
        agents: agentResults,
      };
    } finally {
      await Promise.all(agentSessions.map(async (session) => await session.stop()));
      await Promise.all(mcpServers.map(async (server) => await server.stop()));
      await browserSession.stop();
    }
  }
}
