import { describe, expect, it, vi } from "vitest";
import { fxHarness } from "../../framework/benchHarness.js";
import { EvalLogger } from "../../logger.js";
import {
  buildFxAgentsMarkdown,
  buildFxMcpChildEnv,
  buildFxMcpConfig,
  buildFxSettings,
  cleanupFxRuntime,
  FX_DENIED_TOOLS,
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
        {
          home: "/isolated/home",
          pathEnv: "/usr/bin:/bin",
          parentEnv: {
            HOME: "/runner/home",
            PNPM_HOME: "/runner/pnpm",
            OPENAI_API_KEY: "must-not-leak",
          },
          startupTimeoutMs: 123_000,
        },
      ),
    ).toEqual({
      mcp: {
        stagehand: {
          type: "stdio",
          command: ["/usr/bin/node", "server.mjs", "--flag"],
          environment: {
            PATH: "/usr/bin:/bin",
            HOME: "/runner/home",
            PNPM_HOME: "/runner/pnpm",
            BROWSERBASE_API_KEY: "test",
          },
          required: true,
          startup_timeout_ms: 123_000,
        },
      },
    });
    expect(() =>
      buildFxMcpConfig(
        { "bad server": { command: "node" } },
        {
          home: "/home",
          pathEnv: "/bin",
          parentEnv: {},
          startupTimeoutMs: 120_000,
        },
      ),
    ).toThrow(/Invalid fx MCP server name/u);
    expect(
      buildFxMcpChildEnv(
        { HOME: "/spec/home", PNPM_HOME: "/spec/pnpm" },
        {
          home: "/fallback/home",
          pathEnv: "/bin",
          parentEnv: { HOME: "/runner/home", PNPM_HOME: "/runner/pnpm" },
        },
      ),
    ).toMatchObject({ HOME: "/spec/home", PNPM_HOME: "/spec/pnpm" });
  });

  it("denies unsafe built-ins and allows exact discovered MCP tools", () => {
    expect(buildFxSettings({ stagehand: ["run", "snapshot", "screenshot"] })).toEqual({
      permission: {
        ...Object.fromEntries(FX_DENIED_TOOLS.map((name) => [name, "deny"])),
        "mcp_stagehand_*": "allow",
        mcp_stagehand_run: "allow",
        mcp_stagehand_snapshot: "allow",
        mcp_stagehand_screenshot: "allow",
      },
    });
    expect(buildFxSettings({ "chrome-devtools": ["click"] }).permission).toMatchObject({
      "mcp_chrome-devtools_*": "allow",
      "mcp_chrome_devtools_*": "allow",
      "mcp_chrome-devtools_click": "allow",
      mcp_chrome_devtools_click: "allow",
    });
    expect(buildFxSettings({}).permission).toEqual(
      Object.fromEntries(FX_DENIED_TOOLS.map((name) => [name, "deny"])),
    );
    const permission = buildFxSettings({ stagehand: ["run"] }).permission;
    expect(permission).toMatchObject({
      "*": "deny",
      grep_files: "deny",
      open_file: "deny",
      file_info: "deny",
      semantic_search: "deny",
      vision: "deny",
      "mcp_stagehand_*": "allow",
      mcp_stagehand_run: "allow",
    });
    expect(FX_DENIED_TOOLS).not.toContain("glob" as never);
    expect(FX_DENIED_TOOLS).not.toContain("grep" as never);
  });

  it("redacts cleanup failures before logging", async () => {
    const logger = new EvalLogger(false);
    const warn = vi.spyOn(logger, "warn");
    await cleanupFxRuntime(async () => {
      throw new Error("cleanup failed apiKey=secret123");
    }, logger);
    const logged = JSON.stringify(warn.mock.calls);
    expect(logged).toContain("apiKey=[redacted]");
    expect(logged).not.toContain("secret123");
  });

  it("teaches exact fx MCP selection and Stagehand names", () => {
    const markdown = buildFxAgentsMarkdown("Use snapshots first.", ["stagehand"]);
    expect(markdown).toContain("mcp_select_tool");
    expect(markdown).toContain("mcp_search_tools may return nothing");
    expect(markdown).toContain("mcp_stagehand_run");
    expect(markdown).toContain("mcp_stagehand_snapshot");
    expect(markdown).toContain("mcp_stagehand_screenshot");
    expect(markdown).toContain("web search/fetch");
    expect(markdown).toContain("file tools");
    expect(markdown).toContain("Use snapshots first.");
  });
});
