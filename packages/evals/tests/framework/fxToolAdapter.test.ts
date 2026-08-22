import { describe, expect, it } from "vitest";
import type { ToolSurface } from "../../core/contracts/tool.js";
import {
  buildFxAgentsMarkdown,
  buildFxMcpConfig,
  buildFxSettings,
  resolveFxStartupProfile,
  resolveFxToolSurface,
} from "../../framework/fxToolAdapter.js";

describe("fx tool adapter helpers", () => {
  it("defaults to the Stagehand facade and rejects unsupported surfaces", () => {
    expect(resolveFxToolSurface()).toBe("stagehand_facade");
    expect(resolveFxToolSurface("playwright_mcp")).toBe("playwright_mcp");
    expect(resolveFxToolSurface("chrome_devtools_mcp")).toBe("chrome_devtools_mcp");
    expect(() => resolveFxToolSurface("browse_cli")).toThrow(
      'fx harness supports --tool stagehand_facade, playwright_mcp, or chrome_devtools_mcp; received "browse_cli".',
    );
  });

  it("chooses surface-specific startup profiles", () => {
    expect(resolveFxStartupProfile("stagehand_facade", "LOCAL")).toBe("tool_launch_local");
    expect(resolveFxStartupProfile("stagehand_facade", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(resolveFxStartupProfile("playwright_mcp", "LOCAL")).toBe("runner_provided_local_cdp");
    expect(resolveFxStartupProfile("chrome_devtools_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(resolveFxStartupProfile("playwright_mcp", "LOCAL", "tool_attach_local_cdp")).toBe(
      "tool_attach_local_cdp",
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

  it("rejects a startup default for an unrelated surface", () => {
    expect(() => resolveFxStartupProfile("browse_cli" as ToolSurface, "LOCAL")).toThrow(
      /No fx startup profile default/u,
    );
  });
});
