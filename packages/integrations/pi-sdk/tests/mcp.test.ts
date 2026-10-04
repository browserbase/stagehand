import { describe, expect, it } from "vitest";
import {
  buildPiMcpToolName,
  isPiMcpToolName,
  mcpCallResultToPiToolResult,
  piToolResultText,
} from "../src/index.js";

describe("pi MCP name and result helpers", () => {
  it("builds and matches mcp__ server tool names", () => {
    expect(buildPiMcpToolName("stage.hand", "take shot")).toBe("mcp__stage_hand__take_shot");
    expect(isPiMcpToolName("mcp__stage_hand__run", "stage.hand")).toBe(true);
    expect(isPiMcpToolName("mcp__other__run", "stagehand")).toBe(false);
    expect(isPiMcpToolName("other")).toBe(false);
  });

  it("maps MCP call results, including images and structured errors", () => {
    const mapped = mcpCallResultToPiToolResult({
      content: [
        { type: "text", text: "hello" },
        { type: "image", data: "YWJj", mimeType: "image/png" },
        { type: "unknown", value: 1 },
      ],
      structuredContent: { ok: false },
      isError: true,
    });
    expect(mapped).toMatchObject({ isError: true, details: { ok: false } });
    expect(mapped.content).toEqual([
      { type: "text", text: "hello" },
      { type: "image", data: "YWJj", mimeType: "image/png" },
      { type: "text", text: '{"type":"unknown","value":1}' },
    ]);
    expect(piToolResultText(mapped)).toBe('hello\n{"type":"unknown","value":1}');
  });
});
