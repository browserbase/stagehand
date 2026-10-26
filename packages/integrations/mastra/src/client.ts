import { MCPClient } from "@mastra/mcp";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import { fileURLToPath } from "node:url";

export type FacadeMCPClientOptions = {
  env?: Record<string, string>;
};

/**
 * Starts the facade MCP server and returns its Mastra client.
 * Call `client.disconnect()` when finished to stop the child process and browser.
 */
export function createFacadeMCPClient(options: FacadeMCPClientOptions = {}) {
  // Build @browserbasehq/stagehand-integrations first so this dist entrypoint exists.
  const serverPath = fileURLToPath(
    import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
  );

  const env = buildAllowlistedEnv();

  Object.assign(env, options.env);

  return new MCPClient({
    id: "stagehand-facade-mastra-example",
    servers: {
      stagehand: {
        command: process.execPath,
        args: [serverPath],
        env,
      },
    },
  });
}
