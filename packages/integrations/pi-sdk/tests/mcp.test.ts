import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { attachPiMcpStderrLogger } from "../src/index.js";

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
