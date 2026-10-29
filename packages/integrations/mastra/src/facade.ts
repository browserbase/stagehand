import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import type { MastraStdioServerDefinition } from "@browserbasehq/stagehand-integrations-mastra";
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
