import { describe, expect, it } from "vitest";
import {
  PYDANTIC_AI_TOOL_SURFACES,
  normalizePydanticAiMcpServers,
} from "../../framework/pydanticAiToolAdapter.js";
import {
  resolveStartupProfile,
  resolveToolSurface,
} from "../../framework/harnesses/toolSurfaceResolution.js";

describe("Pydantic AI tool adapter helpers", () => {
  it("resolves supported surfaces and startup profiles", () => {
    const definition = {
      harness: "pydantic_ai",
      supportedToolSurfaces: PYDANTIC_AI_TOOL_SURFACES,
    };
    expect(resolveToolSurface(definition)).toBe("stagehand_facade");
    expect(resolveToolSurface(definition, "playwright_mcp")).toBe("playwright_mcp");
    expect(resolveToolSurface(definition, "chrome_devtools_mcp")).toBe("chrome_devtools_mcp");
    expect(() => resolveToolSurface(definition, "browse_cli")).toThrow(
      /Harness "pydantic_ai" supports --tool stagehand_facade, stagehand_facade_legacy, playwright_mcp, or chrome_devtools_mcp; received "browse_cli"/,
    );
    expect(resolveStartupProfile("stagehand_facade", "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile("stagehand_facade", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(resolveStartupProfile("playwright_mcp", "LOCAL")).toBe("runner_provided_local_cdp");
    expect(resolveStartupProfile("chrome_devtools_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("normalizes valid MCP server configs", () => {
    expect(
      normalizePydanticAiMcpServers({
        stagehand: { command: "node", args: ["server.js"], env: { TOKEN: "x" }, cwd: "/tmp" },
        emptyArgs: { command: "python" },
      }),
    ).toEqual({
      stagehand: { command: "node", args: ["server.js"], env: { TOKEN: "x" }, cwd: "/tmp" },
      emptyArgs: { command: "python", args: [] },
    });
  });

  it("rejects MCP servers without commands", () => {
    expect(() => normalizePydanticAiMcpServers({ broken: { args: [] } })).toThrow(
      /server "broken".*command/,
    );
  });
});
