import { describe, expect, it } from "vitest";
import { getCoreTool, listCoreTools } from "../../core/tools/registry.js";

describe("core tool registry", () => {
  it("lists extended tool surfaces", () => {
    expect(listCoreTools()).toEqual(
      expect.arrayContaining(["playwright_mcp", "chrome_devtools_mcp"]),
    );
  });

  it("constructs MCP tools", () => {
    expect(getCoreTool("playwright_mcp").id).toBe("playwright_mcp");
    expect(getCoreTool("chrome_devtools_mcp").id).toBe("chrome_devtools_mcp");
  });

  it("rejects the removed Browse tool in saved configurations", () => {
    expect(listCoreTools()).not.toContain("browse_cli");
    expect(() => getCoreTool("browse_cli" as never)).toThrow(
      'Tool surface "browse_cli" is not implemented',
    );
  });
});
