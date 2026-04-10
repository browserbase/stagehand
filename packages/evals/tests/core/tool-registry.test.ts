import { describe, expect, it } from "vitest";
import { getCoreTool, listCoreTools } from "../../core/tools/registry.js";

describe("core tool registry", () => {
  it("lists MCP surfaces", () => {
    expect(listCoreTools()).toEqual(
      expect.arrayContaining(["playwright_mcp", "chrome_devtools_mcp"]),
    );
  });

  it("constructs MCP tools", () => {
    expect(getCoreTool("playwright_mcp").id).toBe("playwright_mcp");
    expect(getCoreTool("chrome_devtools_mcp").id).toBe("chrome_devtools_mcp");
  });
});
