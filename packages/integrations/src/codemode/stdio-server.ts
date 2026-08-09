import { connectCodeModeStdio, createCodeModeMcpHost } from "./mcp-runtime.js";
import { closeCodeModeStdio } from "./stdio-lifecycle.js";

const server = createCodeModeMcpHost();
let closing = false;

async function shutdown(code: number): Promise<void> {
  if (closing) return;
  closing = true;
  const clean = await closeCodeModeStdio([server]);
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
process.stderr.write("Stagehand code-mode MCP host listening on stdio\n");
