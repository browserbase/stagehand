import type { StdioLaunchConfig } from "../../types.js";
import type { MCPServerAdapter, MCPServerAdapterContext } from "./base.js";

export class BrowserUseMCPAdapter implements MCPServerAdapter {
  readonly type = "browser-use" as const;

  async getLaunchConfig(
    context: MCPServerAdapterContext,
  ): Promise<StdioLaunchConfig> {
    return {
      command: context.options.command ?? "uvx",
      args: context.options.args?.length
        ? [...context.options.args]
        : ["browser-use[cli]", "--mcp"],
      env: context.options.env,
    };
  }
}
