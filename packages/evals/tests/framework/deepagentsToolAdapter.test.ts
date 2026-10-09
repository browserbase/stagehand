import { describe, expect, it } from "vitest";
import {
  DEEPAGENTS_TOOL_SURFACES,
  normalizeDeepagentsMcpServers,
} from "../../framework/deepagentsToolAdapter.js";
import {
  resolveStartupProfile,
  resolveToolSurface,
} from "../../framework/harnesses/toolSurfaceResolution.js";

describe("Deep Agents tool adapter helpers", () => {
  it("resolves supported surfaces and startup profiles", () => {
    const definition = {
      harness: "deepagents",
      supportedToolSurfaces: DEEPAGENTS_TOOL_SURFACES,
    };
    expect(resolveToolSurface(definition)).toBe("stagehand_facade");
    expect(resolveToolSurface(definition, "playwright_mcp")).toBe("playwright_mcp");
    expect(resolveToolSurface(definition, "chrome_devtools_mcp")).toBe("chrome_devtools_mcp");
    expect(resolveToolSurface(definition, "browse_cli")).toBe("browse_cli");
    expect(() => resolveToolSurface(definition, "stagehand_code")).toThrow(
      /Harness "deepagents" supports --tool browse_cli, stagehand_facade, stagehand_facade_legacy, playwright_mcp, or chrome_devtools_mcp; received "stagehand_code"/,
    );
    expect(resolveStartupProfile("browse_cli", "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile("browse_cli", "BROWSERBASE")).toBe("tool_create_browserbase");
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
      normalizeDeepagentsMcpServers({
        stagehand: { command: "node", args: ["server.js"], env: { TOKEN: "x" }, cwd: "/tmp" },
        emptyArgs: { command: "python" },
      }),
    ).toEqual({
      stagehand: { command: "node", args: ["server.js"], env: { TOKEN: "x" }, cwd: "/tmp" },
      emptyArgs: { command: "python", args: [] },
    });
  });

  it("rejects MCP servers without commands", () => {
    expect(() => normalizeDeepagentsMcpServers({ broken: { args: [] } })).toThrow(
      /server "broken".*command/,
    );
  });
});
