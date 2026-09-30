// Minimal stdio MCP server exposing the Stagehand facade's tool names.
// Newline-delimited JSON-RPC 2.0, no dependencies.
import fs from "node:fs";
import readline from "node:readline";

// Test knobs: record this pid, and never answer tools/list (a wedged facade).
if (process.env.STUB_MCP_PID_FILE)
  fs.writeFileSync(process.env.STUB_MCP_PID_FILE, String(process.pid));
const hangListTools = process.env.STUB_MCP_HANG_LIST_TOOLS === "1";
// A wedged bridge also ignores stdin EOF: keep the event loop alive.
if (hangListTools) setInterval(() => undefined, 60_000);

const TOOLS = ["run", "snapshot", "screenshot"].map((name) => ({
  name,
  description: `stub ${name}`,
  inputSchema: { type: "object", properties: { code: { type: "string" } } },
}));
// 1x1 transparent PNG.
const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
readline.createInterface({ input: process.stdin }).on("line", (line) => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "stub-stagehand", version: "0.0.0" },
      },
    });
  } else if (message.method === "tools/list") {
    if (hangListTools) return;
    send({ jsonrpc: "2.0", id: message.id, result: { tools: TOOLS } });
  } else if (message.method === "tools/call") {
    const name = message.params?.name;
    const content =
      name === "screenshot"
        ? [{ type: "image", data: PNG, mimeType: "image/png" }]
        : [{ type: "text", text: `${name} ok: url=https://example.com/` }];
    send({ jsonrpc: "2.0", id: message.id, result: { content } });
  } else {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
