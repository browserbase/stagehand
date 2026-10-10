import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { runOpenCodeSession } from "../dist/index.mjs";

const names = ["run", "snapshot", "screenshot"];

const mcpFixture = `
import { createInterface } from "node:readline";
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  const result = request.method === "initialize"
    ? { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "review-fixture", version: "1" } }
    : request.method === "tools/list"
      ? { tools: ["run", "snapshot", "screenshot"].map(name => ({ name, description: name, inputSchema: { type: "object", properties: {} } })) }
      : {};
  const respond = () => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: request.id, result }) + "\\n");
  if (request.method === "initialize") setTimeout(respond, 150);
  else respond();
});
`;

describe("OpenCode MCP registration", () => {
  it("sends delayed MCP tools in the worker's first provider request", async () => {
    const root = await mkdtemp(join(tmpdir(), "stagehand-opencode-catalog-test-"));
    const requests: string[][] = [];
    const server = createServer(async (request, response) => {
      let raw = "";
      for await (const chunk of request) raw += String(chunk);
      const body = JSON.parse(raw) as { tools?: Array<{ function: { name: string } }> };
      requests.push((body.tools ?? []).map((tool) => tool.function.name));
      response.writeHead(200, { "content-type": "text/event-stream" });
      const chunk = {
        id: "mock",
        object: "chat.completion.chunk",
        created: 1,
        model: "mock",
        choices: [{ index: 0, delta: { role: "assistant", content: "done" }, finish_reason: null }],
      };
      response.end(
        `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({
          ...chunk,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })}\n\ndata: [DONE]\n\n`,
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const fixture = join(root, "mcp.mjs");
      await writeFile(fixture, mcpFixture);
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("Missing test server address.");
      const providerConfig = {
        providers: {
          mock: {
            package: "@opencode/ai/providers/openai-compatible",
            settings: { baseURL: `http://127.0.0.1:${address.port}/v1`, apiKey: "dummy" },
            models: {
              test: {
                modelID: "mock",
                capabilities: { tools: true, input: ["text"], output: ["text"] },
                limit: { context: 10_000, output: 1_000 },
              },
            },
          },
        },
      };
      const result = await runOpenCodeSession({
        prompt: "Call stagehand_snapshot.",
        model: "mock/test",
        signal: AbortSignal.timeout(20_000),
        logger: { log() {}, warn() {}, error() {} },
        session: {
          directory: join(root, "workspace"),
          configRoot: join(root, "config"),
          config: {
            model: "mock/test",
            share: "disabled",
            update: "disable",
            ...providerConfig,
            mcp: {
              servers: {
                stagehand: { type: "local", codemode: false, command: [process.execPath, fixture] },
                disabled: {
                  type: "local",
                  codemode: false,
                  command: ["unavailable"],
                  disabled: true,
                },
              },
            },
            permissions: [
              { action: "*", resource: "*", effect: "deny" },
              ...names.map((name) => ({
                action: `stagehand_${name}`,
                resource: "*",
                effect: "allow" as const,
              })),
            ],
          },
        },
      });
      expect(result.status).toBe("completed");
      expect(requests[0]?.slice().sort()).toEqual(names.map((name) => `stagehand_${name}`).sort());
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
  it("cancels an MCP startup that never registers tools", async () => {
    const root = await mkdtemp(join(tmpdir(), "stagehand-opencode-abort-test-"));
    try {
      const result = await runOpenCodeSession({
        prompt: "This prompt must not reach a provider.",
        model: "opencode/auto",
        signal: AbortSignal.timeout(500),
        logger: { log() {}, warn() {}, error() {} },
        session: {
          directory: join(root, "workspace"),
          configRoot: join(root, "config"),
          config: {
            mcp: {
              servers: {
                stagehand: {
                  type: "local",
                  codemode: false,
                  command: [process.execPath, "-e", "setInterval(() => {}, 1000)"],
                },
              },
            },
            permissions: [{ action: "*", resource: "*", effect: "deny" }],
          },
        },
      });
      expect(result.status).toBe("sdk_error");
      expect(result.stopReason).toContain("timeout");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 10_000);
});
