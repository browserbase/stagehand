import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import { fileURLToPath } from "node:url";

export type FacadeMCPClientOptions = {
  env?: Record<string, string>;
};

/**
 * Starts the stdio facade server as a child process and returns the AI SDK
 * MCP client connected to it. Call `client.close()` when finished to stop the
 * child process and the browser it manages.
 */
export async function createFacadeMCPClient(options: FacadeMCPClientOptions = {}) {
  // Build @browserbasehq/stagehand-integrations first so this dist entrypoint exists.
  const serverPath = fileURLToPath(
    import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
  );

  // The transport adds HOME, LOGNAME, PATH, SHELL, TERM, and USER from the host
  // on top of this allowlist, so options.env cannot override those variables.
  const env = buildAllowlistedEnv();

  Object.assign(env, options.env);

  return createMCPClient({
    clientName: "stagehand-facade-vercel-ai-example",
    transport: new Experimental_StdioMCPTransport({
      command: process.execPath,
      args: [serverPath],
      env,
    }),
  });
}
