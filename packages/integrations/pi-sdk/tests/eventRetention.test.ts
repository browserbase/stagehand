import { afterEach, describe, expect, it, vi } from "vitest";
import { compactPiEvent, runPiSession, summarizePiEvent, type PiEvent } from "../src/session.js";

afterEach(() => vi.restoreAllMocks());

describe("Pi retained event limits", () => {
  it.each(["assistant", "tool", "unknown"])("redacts before clipping %s details", (kind) => {
    const secret = `AIza${"A".repeat(35)}`;
    const makeEvent = (text: string): PiEvent =>
      kind === "assistant"
        ? { type: "message_end", message: { role: "assistant", content: [{ type: "text", text }] } }
        : kind === "tool"
          ? { type: "tool_execution_end", result: text }
          : { type: "custom", detail: text };
    const raw = kind === "assistant" ? secret : JSON.stringify(makeEvent(secret));
    const padding = "x".repeat(20_000 - 16 - raw.indexOf(secret)) + " ";
    const summary = summarizePiEvent(makeEvent(padding + secret));
    expect(summary.detail?.length).toBeLessThanOrEqual(20_000);
    expect(summary.detail?.includes("AIzaAAAA")).toBe(false);
    expect(summary.detail).toContain("AIza[redacted]");
  });

  it("rejects a large image before allocating a decoded buffer", () => {
    const data = "A".repeat(12 * 1024 * 1024);
    const from = vi.spyOn(Buffer, "from");
    const event = imageEvent(data);
    const retained = compactPiEvent(event);
    expect(from.mock.calls.some(([value]) => value === data)).toBe(false);
    expect(retained.result).toMatchObject({
      content: [{ type: "text", text: expect.stringContaining("Screenshot omitted") }],
    });
    expect(JSON.stringify(retained)).not.toContain(data);
    expect((event.result as { content: Array<{ data: string }> }).content[0].data).toBe(data);
  });

  it("shares the 64 MiB retained-image budget across the entire run", async () => {
    const data = Buffer.alloc(1024 * 1024).toString("base64");
    let listener: (event: PiEvent) => void = () => {};
    const result = await runPiSession({
      prompt: "Fixture task",
      model: "fixture/model",
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      session: {},
      sdk: {
        async createSession() {
          return {
            agent: { state: {} },
            subscribe(fn) {
              listener = fn;
              return () => {};
            },
            async prompt() {
              for (let i = 0; i < 65; i++) listener(imageEvent(data));
            },
            async abort() {},
            dispose() {},
          };
        },
      },
    });
    const blocks = result.events.map(
      (event) => (event.result as { content: Array<Record<string, unknown>> }).content[0],
    );
    expect(blocks.filter((block) => Buffer.isBuffer(block.bytes))).toHaveLength(64);
    expect(blocks[64]).toMatchObject({
      type: "text",
      text: expect.stringContaining("Screenshot omitted"),
    });
    expect(blocks[64]).not.toHaveProperty("data");
    expect(blocks[64]).not.toHaveProperty("bytes");
    expect(result.status).toBe("completed");
  });
});

function imageEvent(data: string): PiEvent {
  return {
    type: "tool_execution_end",
    toolCallId: "fixture",
    toolName: "screenshot",
    result: { content: [{ type: "image", data, mimeType: "image/png" }] },
  };
}
