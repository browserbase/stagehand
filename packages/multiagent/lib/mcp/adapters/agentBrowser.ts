import type { StdioLaunchConfig } from "../../types.js";
import { resolvePackageBin } from "../../utils/process.js";
import type { MCPServerAdapter, MCPServerAdapterContext } from "./base.js";

export class AgentBrowserMCPAdapter implements MCPServerAdapter {
  readonly type = "agent-browser" as const;

  async getLaunchConfig(
    context: MCPServerAdapterContext,
  ): Promise<StdioLaunchConfig> {
    const serverEntry = resolvePackageBin("agent-browser-mcp", "agent-browser-mcp");
    const agentBrowserPath = resolvePackageBin("agent-browser", "agent-browser");

    return {
      command: process.execPath,
      args: [serverEntry, ...(context.options.args ?? [])],
      env: {
        AGENT_BROWSER_PATH: agentBrowserPath,
        ...(context.options.env ?? {}),
      },
    };
  }
}
