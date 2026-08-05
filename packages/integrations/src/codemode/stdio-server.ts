import { stagehandCodeConfigFromEnv } from "./config.js";
import { StagehandCodeExecutor } from "./executor.js";
import { connectCodeModeStdio } from "./mcp-server.js";

const executor = new StagehandCodeExecutor(stagehandCodeConfigFromEnv());
const server = await connectCodeModeStdio(executor);
let closing = false;

async function shutdown(code: number): Promise<void> {
  if (closing) return;
  closing = true;
  await server.close().catch(() => undefined);
  await executor.close().catch(() => {
    process.stderr.write("Failed to close Stagehand code mode cleanly.\n");
  });
  process.exit(code);
}

process.once("SIGINT", () => void shutdown(0));
process.once("SIGTERM", () => void shutdown(0));
process.stdin.once("end", () => void shutdown(0));
process.stdin.once("close", () => void shutdown(0));
process.stderr.write("Stagehand code-mode MCP listening on stdio\n");
