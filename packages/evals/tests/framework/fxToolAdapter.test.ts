import { describe, expect, it } from "vitest";
import { fxHarness } from "../../framework/benchHarness.js";
import {
  buildFxAgentsMarkdown,
  buildFxMcpConfig,
  buildFxSettings,
  FX_TOOL_SURFACES,
} from "../../framework/fxToolAdapter.js";
import {
  resolveStartupProfile,
  resolveToolSurface,
} from "../../framework/harnesses/toolSurfaceResolution.js";

describe("fx tool adapter helpers", () => {
  it("resolves surfaces and startup profiles through the shared registry helpers", () => {
    expect(FX_TOOL_SURFACES).toEqual(["stagehand_facade", "playwright_mcp", "chrome_devtools_mcp"]);
    expect(resolveToolSurface(fxHarness)).toBe("stagehand_facade");
    expect(resolveToolSurface(fxHarness, "playwright_mcp")).toBe("playwright_mcp");
    expect(() => resolveToolSurface(fxHarness, "browse_cli")).toThrow(
      'Harness "fx" supports --tool stagehand_facade, playwright_mcp, or chrome_devtools_mcp; received "browse_cli".',
    );
    expect(resolveStartupProfile("stagehand_facade", "LOCAL")).toBe("tool_launch_local");
    expect(resolveStartupProfile("chrome_devtools_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
  });

  it("builds fx MCP launch specs with an explicit child environment", () => {
    expect(
      buildFxMcpConfig(
        {
          stagehand: {
            command: "/usr/bin/node",
            args: ["server.mjs", "--flag"],
            env: { BROWSERBASE_API_KEY: "test" },
          },
        },
        { home: "/isolated/home", pathEnv: "/usr/bin:/bin" },
      ),
    ).toEqual({
      mcp: {
        stagehand: {
          type: "stdio",
          command: ["/usr/bin/node", "server.mjs", "--flag"],
          environment: {
            PATH: "/usr/bin:/bin",
            HOME: "/isolated/home",
            BROWSERBASE_API_KEY: "test",
          },
          required: true,
        },
      },
    });
    expect(() =>
      buildFxMcpConfig({ "bad server": { command: "node" } }, { home: "/home", pathEnv: "/bin" }),
    ).toThrow(/Invalid fx MCP server name/u);
  });

  it("denies shell and editing tools and narrowly allows the facade", () => {
    expect(buildFxSettings(["stagehand"], "stagehand_facade")).toEqual({
      permission: {
        run_command: "deny",
        terminal: "deny",
        write_file: "deny",
        edit_file: "deny",
        mcp_stagehand_run: "allow",
        mcp_stagehand_snapshot: "allow",
        mcp_stagehand_screenshot: "allow",
      },
    });
    expect(buildFxSettings(["playwright"], "playwright_mcp").permission).toEqual({
      run_command: "deny",
      terminal: "deny",
      write_file: "deny",
      edit_file: "deny",
    });
  });

  it("teaches exact fx MCP selection and Stagehand names", () => {
    const markdown = buildFxAgentsMarkdown("Use snapshots first.", ["stagehand"]);
    expect(markdown).toContain("mcp_select_tool");
    expect(markdown).toContain("mcp_search_tools may return nothing");
    expect(markdown).toContain("mcp_stagehand_run");
    expect(markdown).toContain("mcp_stagehand_snapshot");
    expect(markdown).toContain("mcp_stagehand_screenshot");
    expect(markdown).toContain("Use snapshots first.");
  });
});
