import { describe, expect, it } from "vitest";
import { FLUE_TOOL_SURFACES, flueMcpToolName } from "../../framework/flueToolAdapter.js";

describe("Flue tool adapter helpers", () => {
  it("supports the shared MCP tool surfaces", () => {
    expect(FLUE_TOOL_SURFACES).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
  });

  it("uses Flue's MCP tool namespace and sanitizes names", () => {
    expect(flueMcpToolName("stage.hand", "take shot")).toBe("mcp__stage_hand__take_shot");
  });
});
