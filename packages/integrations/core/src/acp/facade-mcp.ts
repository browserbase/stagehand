import type { McpServerStdio } from "@agentclientprotocol/sdk";
import { fileURLToPath } from "node:url";

import { buildAcpFacadeEnv } from "./env.js";

export function buildAcpFacadeMcpServer(
  facadeServerPath: string,
  source: NodeJS.ProcessEnv = process.env,
): McpServerStdio {
  const facadeLauncherPath = fileURLToPath(new URL("./facade-launcher.mjs", import.meta.url));
  return {
    name: "stagehand",
    command: process.execPath,
    args: [facadeLauncherPath, facadeServerPath],
    env: Object.entries(buildAcpFacadeEnv(source)).map(([name, value]) => ({ name, value })),
  };
}
