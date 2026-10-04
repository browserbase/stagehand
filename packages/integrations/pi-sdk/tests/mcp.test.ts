import { describe, expect, it } from "vitest";
import { isPiMcpToolName } from "../src/index.js";

describe("pi MCP tool names", () => {
  it("matches the mounted server after Pi normalizes its name", () => {
    expect(isPiMcpToolName("mcp__stagehand__run")).toBe(true);
    expect(isPiMcpToolName("mcp__stage_hand__run", "stage-hand")).toBe(true);
    expect(isPiMcpToolName("mcp__stagehand_extra__run", "stagehand")).toBe(false);
    expect(isPiMcpToolName("mcp__other__run", "stagehand")).toBe(false);
    expect(isPiMcpToolName("run")).toBe(false);
  });
});
