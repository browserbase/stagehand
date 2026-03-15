import type { MCPServerOptions } from "../types.js";
import { UnsupportedAdapterError } from "../utils/errors.js";
import { AgentBrowserMCPAdapter } from "./adapters/agentBrowser.js";
import type { MCPServerAdapter } from "./adapters/base.js";
import { BrowserUseMCPAdapter } from "./adapters/browserUse.js";
import { ChromeDevtoolsMCPAdapter } from "./adapters/chromeDevtools.js";
import { PlaywrightMCPAdapter } from "./adapters/playwright.js";
import { StagehandAgentMCPAdapter } from "./adapters/stagehandAgent.js";
import { UnderstudyMCPAdapter } from "./adapters/understudy.js";

const adapters: Record<MCPServerOptions["type"], MCPServerAdapter> = {
  playwright: new PlaywrightMCPAdapter(),
  "chrome-devtools": new ChromeDevtoolsMCPAdapter(),
  "agent-browser": new AgentBrowserMCPAdapter(),
  "browser-use": new BrowserUseMCPAdapter(),
  "stagehand-agent": new StagehandAgentMCPAdapter(),
  understudy: new UnderstudyMCPAdapter(),
};

export function getMCPServerAdapter(
  type: MCPServerOptions["type"],
): MCPServerAdapter {
  const adapter = adapters[type];
  if (!adapter) {
    throw new UnsupportedAdapterError("MCP server", type);
  }
  return adapter;
}
