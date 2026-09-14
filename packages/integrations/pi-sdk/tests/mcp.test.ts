import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachPiMcpStderrLogger, connectPiMcpServers } from "../src/index.js";

const clientMocks = vi.hoisted(() => ({
  connect: vi.fn(),
  listTools: vi.fn(),
  callTool: vi.fn(),
  close: vi.fn(),
}));

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect = clientMocks.connect;
    listTools = clientMocks.listTools;
    callTool = clientMocks.callTool;
    close = clientMocks.close;
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: class {
    stderr = undefined;
  },
}));

describe("pi MCP stderr logging", () => {
  it("buffers complete lines, redacts split secrets, and flushes trailing output", async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const stderr = new PassThrough();
    attachPiMcpStderrLogger(stderr, logger);

    stderr.write("Authorization: Bearer sk-live-abcd");
    stderr.write("efghijklmnop1234 done\nsecond line\npart");
    stderr.end();
    await new Promise<void>((resolve) => stderr.once("close", resolve));

    expect(logger.log).toHaveBeenCalledTimes(3);
    const messages = logger.log.mock.calls.map(([line]) => line.message);
    expect(messages[0]).toContain("[redacted]");
    expect(messages[0]).not.toContain("efghijklmnop1234");
    expect(messages[1]).toBe("second line");
    expect(messages[2]).toBe("part");
    expect(messages).not.toContain("Authorization: Bearer sk-live-abcd");
  });

  it("emits two entries for two complete lines in one chunk", () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const stderr = new PassThrough();
    attachPiMcpStderrLogger(stderr, logger);

    stderr.write("first line\r\nsecond line\n");

    expect(logger.log.mock.calls.map(([line]) => line.message)).toEqual([
      "first line",
      "second line",
    ]);
    stderr.end();
  });
});

describe("pi MCP failures", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientMocks.close.mockResolvedValue(undefined);
  });

  it("wraps connection failures without exposing the raw error", async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    clientMocks.connect.mockRejectedValueOnce(new Error("spawn failed sk-secret1234567890"));

    await expect(connectPiMcpServers({ test: { command: "broken" } }, { logger })).rejects.toThrow(
      "Failed to connect pi MCP servers.",
    );
  });

  it("turns server-declared tool failures into a fixed typed error", async () => {
    const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
    clientMocks.connect.mockResolvedValueOnce(undefined);
    clientMocks.listTools.mockResolvedValueOnce({
      tools: [{ name: "fail", description: "", inputSchema: {} }],
    });
    clientMocks.callTool.mockResolvedValueOnce({
      isError: true,
      content: [{ type: "text", text: "raw server secret sk-secret1234567890" }],
    });
    const connected = await connectPiMcpServers({ test: { command: "server" } }, { logger });

    await expect(
      connected.tools[0].execute("id", {}, undefined, undefined, {} as never),
    ).rejects.toThrow("Pi MCP tool failed.");
    await connected.close();
  });
});
