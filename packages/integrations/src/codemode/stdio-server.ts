#!/usr/bin/env node

import { stagehandCodeConfigFromEnv } from "./config.js";
import { StagehandCodeExecutor } from "./executor.js";
import { createCodeModeMcpServer } from "./mcp-server.js";
import { connectCodeModeStdio } from "./mcp-runtime.js";
import { closeCodeModeStdio } from "./stdio-lifecycle.js";

const executor = new StagehandCodeExecutor(stagehandCodeConfigFromEnv());
const server = createCodeModeMcpServer(executor);
let closing = false;

async function shutdown(code: number): Promise<void> {
  if (closing) return;
  closing = true;
  const clean = await closeCodeModeStdio([server, executor]);
  if (!clean) {
    process.stderr.write("Failed to close Stagehand code mode cleanly.\n");
  }
  process.exit(code === 0 && !clean ? 1 : code);
}

process.once("SIGINT", () => void shutdown(130));
process.once("SIGTERM", () => void shutdown(143));
process.stdin.once("end", () => void shutdown(0));
process.stdin.once("close", () => void shutdown(0));

await connectCodeModeStdio(server);
process.stderr.write("Stagehand code-mode MCP listening on stdio\n");
