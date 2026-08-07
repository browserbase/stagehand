import { describe, expect, it } from "vitest";
import { getCoreTool, listCoreTools } from "../../core/tools/registry.js";
import { buildStagehandCodePromptInstructions } from "../../core/tools/stagehand_code.js";

describe("core tool registry", () => {
  it("lists extended tool surfaces", () => {
    expect(listCoreTools()).toEqual(
      expect.arrayContaining(["playwright_mcp", "chrome_devtools_mcp", "browse_cli"]),
    );
  });

  it("constructs MCP and CLI tools", () => {
    expect(getCoreTool("playwright_mcp").id).toBe("playwright_mcp");
    expect(getCoreTool("chrome_devtools_mcp").id).toBe("chrome_devtools_mcp");
    expect(getCoreTool("browse_cli").id).toBe("browse_cli");
    expect(getCoreTool("stagehand_code").id).toBe("stagehand_code");
  });

  it("shows Stagehand locator actions to coding agents", () => {
    const prompt = buildStagehandCodePromptInstructions();

    expect(prompt).toContain("goBack()/goForward()");
    expect(prompt).toContain("keyPress(key)");
    expect(prompt).toContain("click(x,y), hover(x,y)");
    expect(prompt).toContain(
      "page.locator(selector): count(), click(), hover(), fill(value), type(text), isVisible(), textContent(), inputValue()",
    );
    expect(prompt).toContain("Page accessors are async RPCs — always await them.");
  });
});
