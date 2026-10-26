import { describe, expect, it, vi } from "vitest";
import { loadMastraSdk, runMastraSession, type MastraSdk } from "../src/index.js";

const logger = { log: () => {}, warn: () => {}, error: () => {} };

function stdioServer(port: string) {
  return {
    stagehand: {
      command: "node",
      args: ["-e", "setTimeout(()=>{}, 1e6)"],
      env: { PORT: port },
    },
  };
}

describe("Mastra MCP client IDs", () => {
  it("uses unique session IDs that do not disconnect another real client", async () => {
    const ids: string[] = [];
    const sdk: MastraSdk = {
      createAgent: () => ({
        stream: async () => ({
          fullStream: (async function* () {})(),
        }),
      }),
      createMcpClient: (options) => {
        if (options.id) ids.push(options.id);
        return {
          listToolsWithErrors: async () => ({ tools: {}, errors: {} }),
          disconnect: async () => {},
        };
      },
      createTool: (options) => options,
    };

    for (const port of ["50001", "50002"]) {
      await runMastraSession({
        prompt: "task",
        model: "openai/gpt-5.4-mini",
        logger,
        sdk,
        session: { mcpServers: stdioServer(port) },
      });
    }

    expect(ids).toHaveLength(2);
    expect(ids[0]).toMatch(/^stagehand-evals-mastra-/);
    expect(ids[1]).toMatch(/^stagehand-evals-mastra-/);
    expect(ids[0]).not.toBe(ids[1]);
    const [firstId, secondId] = ids;
    if (!firstId || !secondId) throw new Error("expected two MCP client IDs");

    // Construct REAL @mastra/mcp MCPClient instances through the production
    // loader. @mastra/mcp caches live clients by id and disconnects a cached
    // client when a new one reuses its id with different server configs, so
    // the per-session ids must keep concurrent rows from tearing each other down.
    const real = await loadMastraSdk();
    const first = real.createMcpClient({ id: firstId, servers: stdioServer("50001") });
    const disconnect = vi.spyOn(first, "disconnect");
    let second: ReturnType<MastraSdk["createMcpClient"]> | undefined;
    try {
      second = real.createMcpClient({ id: secondId, servers: stdioServer("50002") });
      expect(disconnect).not.toHaveBeenCalled();
      expect(second).not.toBe(first);
    } finally {
      disconnect.mockRestore();
      await Promise.all([first.disconnect(), second?.disconnect()]);
    }
  });
});
