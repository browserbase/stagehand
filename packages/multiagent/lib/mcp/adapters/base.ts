import type { BrowserSession } from "../../browser/session.js";
import type { MCPServerOptions, StdioLaunchConfig } from "../../types.js";

export interface MCPServerAdapterContext {
  browserSession?: BrowserSession;
  options: MCPServerOptions;
}

export interface MCPServerAdapter {
  readonly type: MCPServerOptions["type"];
  getLaunchConfig(context: MCPServerAdapterContext): Promise<StdioLaunchConfig>;
}
