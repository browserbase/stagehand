import { describe, expect, it } from "vitest";
import { getCoreTool, listCoreTools } from "../../core/tools/registry.js";

describe("core tool registry", () => {
  it("lists extended tool surfaces", () => {
    expect(listCoreTools()).toEqual(
      expect.arrayContaining([
        "playwright_mcp",
        "chrome_devtools_mcp",
        "browse_cli",
      ]),
    );
  });

  it("constructs MCP and CLI tools", () => {
    expect(getCoreTool("playwright_mcp").id).toBe("playwright_mcp");
    expect(getCoreTool("chrome_devtools_mcp").id).toBe("chrome_devtools_mcp");
    expect(getCoreTool("browse_cli").id).toBe("browse_cli");
  });
});
