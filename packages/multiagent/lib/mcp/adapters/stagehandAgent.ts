import fs from "node:fs";
import type { StdioLaunchConfig } from "../../types.js";
import { getDistCliPath, getSourceCliPath } from "../../utils/runtimePaths.js";
import type { MCPServerAdapter, MCPServerAdapterContext } from "./base.js";

function getSelfCommand(): StdioLaunchConfig {
  const distCli = getDistCliPath();
  const sourceCli = getSourceCliPath();

  if (!fs.existsSync(distCli)) {
    return {
      command: process.execPath,
      args: ["--import", "tsx", sourceCli],
    };
  }

  return {
    command: process.execPath,
    args: [distCli],
  };
}

export class StagehandAgentMCPAdapter implements MCPServerAdapter {
  readonly type = "stagehand-agent" as const;

  async getLaunchConfig(
    context: MCPServerAdapterContext,
  ): Promise<StdioLaunchConfig> {
    const self = getSelfCommand();
    const args = [
      ...(self.args ?? []),
      "mcp-server",
      "stagehand-agent",
      ...(context.browserSession?.getCdpUrl()
        ? ["--cdp-url", context.browserSession.getCdpUrl() as string]
        : []),
      ...(context.options.args ?? []),
    ];

    return {
      command: self.command,
      args,
      env: context.options.env,
    };
  }
}
