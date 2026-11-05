import { describe, expect, it } from "vitest";
import { isPiMcpToolName } from "../src/index.js";

describe("native Pi MCP names", () => {
  it("matches Pi's normalized server prefix without matching other servers", () => {
    expect(isPiMcpToolName("mcp__stagehand__run")).toBe(true);
    expect(isPiMcpToolName("mcp__stage_hand__take_shot", "stage-hand")).toBe(true);
    expect(isPiMcpToolName("mcp__stagehand_other__run", "stagehand")).toBe(false);
    expect(isPiMcpToolName("mcp__other__run", "stagehand")).toBe(false);
    expect(isPiMcpToolName("run")).toBe(false);
  });
});
