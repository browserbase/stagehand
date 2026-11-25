import { describe, expect, it } from "vitest";
import { extractCursorToolCall, parseCursorStreamLine } from "../src/events.js";

function completed(result: unknown) {
  return {
    type: "tool_call",
    subtype: "completed",
    call_id: "one",
    tool_call: {
      mcpToolCall: {
        args: { providerIdentifier: "stagehand", name: "run", args: { code: "return 1" } },
        result: { success: result },
      },
    },
  };
}

describe("Cursor historical and SDK event decoding", () => {
  it("retains historical function calls and ignores non-event lines", () => {
    expect(parseCursorStreamLine("Cursor Agent startup")).toBeUndefined();
    expect(
      extractCursorToolCall({
        type: "tool_call",
        subtype: "completed",
        call_id: "old",
        tool_call: {
          function: { name: "legacy", arguments: '{"value":2}', result: { success: "ok" } },
        },
      }),
    ).toMatchObject({ callId: "old", name: "legacy", args: { value: 2 }, result: "ok", ok: true });
  });

  it("preserves nested MCP text and images with concrete tool names", () => {
    const blocks = [
      { type: "text", text: "Error rate: 0%" },
      { type: "image", data: "PNG", mimeType: "image/png" },
    ];
    const result = extractCursorToolCall(completed({ content: blocks }));
    expect(result).toMatchObject({ name: "stagehand.run", args: { code: "return 1" }, ok: true });
    expect(JSON.stringify(result?.result)).toContain("PNG");
    expect(JSON.stringify(result?.result)).toContain("Error rate: 0%");
  });

  it("uses explicit MCP isError instead of interpreting text as an error", () => {
    expect(
      extractCursorToolCall(completed({ content: [{ type: "text", text: "Error rate: 0%" }] }))?.ok,
    ).toBe(true);
    expect(
      extractCursorToolCall(
        completed({ isError: true, content: [{ type: "text", text: "target missing" }] }),
      ),
    ).toMatchObject({ ok: false });
  });
});
