import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import type {
  MastraSessionConfig,
  MastraStdioServerDefinition,
} from "@browserbasehq/stagehand-integrations-mastra";
import { fileURLToPath } from "node:url";

/**
 * How Stagehand mounts into Mastra: the facade MCP server over stdio, as a
 * server definition for `runMastraSession({ session: { mcpServers } })`.
 * From the host environment the child receives only the allowlisted STAGEHAND_* /
 * BROWSERBASE_* variables, plus the default launch variables (PATH, HOME, ...) the
 * MCP SDK adds when it spawns a stdio server.
 */
export function facadeMcpServer(): MastraStdioServerDefinition {
  const serverPath = fileURLToPath(
    import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
  );

  return {
    command: process.execPath,
    args: [serverPath],
    env: buildAllowlistedEnv(),
  };
}

export function facadeAgentSession(): MastraSessionConfig {
  return {
    agentId: "stagehand-facade-agent",
    agentName: "Stagehand Facade Agent",
    instructions: FACADE_AGENT_INSTRUCTIONS,
    maxSteps: 20,
    mcpServers: { stagehand: facadeMcpServer() },
  };
}
