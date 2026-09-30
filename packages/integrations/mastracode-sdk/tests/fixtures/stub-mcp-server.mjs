// Minimal stdio MCP server exposing the Stagehand facade's tool names.
// Newline-delimited JSON-RPC 2.0, no dependencies.
import readline from "node:readline";

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
