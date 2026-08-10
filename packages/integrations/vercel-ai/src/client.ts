import { createMCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import { fileURLToPath } from "node:url";

export type FacadeMCPClientOptions = {
  env?: Record<string, string>;
};

/** Only STAGEHAND_* and BROWSERBASE_* host env vars cross into the server. */
export function buildAllowlistedEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(STAGEHAND_|BROWSERBASE_)/.test(key) && value) {
      env[key] = value;
    }
  }
  return env;
}

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
