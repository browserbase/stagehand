import type { BrowserSession } from "../browser/session.js";
import type { MCPServerOptions } from "../types.js";
import { MCPServer } from "./server.js";

export function createMCPServer(
  options: MCPServerOptions,
  browserSession?: BrowserSession,
): MCPServer {
  return new MCPServer(options, browserSession);
}

export { MCPServer } from "./server.js";
