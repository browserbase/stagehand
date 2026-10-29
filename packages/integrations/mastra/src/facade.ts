import { FACADE_AGENT_INSTRUCTIONS } from "@browserbasehq/stagehand-integrations/facade";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import type {
  MastraSessionConfig,
  MastraStdioServerDefinition,
} from "@browserbasehq/stagehand-integrations-mastra";
import { fileURLToPath } from "node:url";

export type FacadeMcpServerOptions = {
  env?: Record<string, string>;
};

/**
 * How Stagehand mounts into Mastra: the facade MCP server over stdio, as a
 * server definition for `runMastraSession({ session: { mcpServers } })`.
 * The child receives only the allowlisted STAGEHAND_* / BROWSERBASE_* host variables.
 */
export function facadeMcpServer(options: FacadeMcpServerOptions = {}): MastraStdioServerDefinition {
  // Build @browserbasehq/stagehand-integrations first so this dist entrypoint exists.
  const serverPath = fileURLToPath(
    import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
  );

  return {
    command: process.execPath,
    args: [serverPath],
    env: { ...buildAllowlistedEnv(), ...options.env },
  };
}

/**
 * The example agent's session: the facade server under its own tool names
 * (run/snapshot/screenshot), which FACADE_AGENT_INSTRUCTIONS references.
 * Evals keeps the adapter defaults (stagehand_run, ...).
 *
 * Tool failures reach the model as tool results (the adapter's
 * `onToolError: "return"`, shared with evals) rather than as thrown errors.
 */
export function facadeAgentSession(options: FacadeMcpServerOptions = {}): MastraSessionConfig {
  return {
    agentId: "stagehand-facade-agent",
    agentName: "Stagehand Facade Agent",
    instructions: FACADE_AGENT_INSTRUCTIONS,
    maxSteps: 20,
    mcpServers: { stagehand: facadeMcpServer(options) },
    toolNames: "bare",
    mcpClientIdPrefix: "stagehand-facade-mastra-example",
  };
}
