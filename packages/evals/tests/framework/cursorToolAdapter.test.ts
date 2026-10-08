import fsp from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CURSOR_TOOL_SURFACES,
  isCursorMountToolName,
  prepareCursorToolAdapter,
} from "../../framework/cursorToolAdapter.js";
import { resolveToolSurface } from "../../framework/harnesses/toolSurfaceResolution.js";
import { startAgentToolRuntime } from "../../framework/agentToolRuntime.js";
import { EvalLogger } from "../../logger.js";

vi.mock("../../framework/agentToolRuntime.js", () => ({ startAgentToolRuntime: vi.fn() }));

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

describe("cursor tool adapter helpers", () => {
  it("passes the runner mount directly to the SDK without creating CLI configuration", async () => {
    const servers = { stagehand: { command: "node", args: ["shared-relay.js"] } };
    const cleanup = vi.fn(async () => {});
    const unavailable = async (): Promise<never> => {
      throw new Error("unused page method");
    };
    vi.mocked(startAgentToolRuntime).mockResolvedValue({
      browserSession: { provider: "local" },
      running: {
        session: {
          listPages: async () => [],
          activePage: unavailable,
          newPage: unavailable,
          selectPage: unavailable,
          closePage: unavailable,
          close: async () => {},
          getArtifacts: async () => [],
          getRawMetrics: async () => ({}),
        },
        agentMount: { via: "mcp", mcpServers: servers, promptInstructions: "Use shared tools." },
        metadata: { environment: "local", browserOwnership: "tool", connectionMode: "launch" },
        cleanup,
      },
      cleanup,
    });
    const adapter = await prepareCursorToolAdapter({
      environment: "LOCAL",
      toolSurface: "stagehand_facade",
      logger: new EvalLogger(false),
      plan: {
        dataset: "webvoyager",
        taskId: "mount",
        instruction: "Read heading",
        startUrl: "https://example.com",
      },
    });
    tempDirs.push(adapter.cwd);
    expect(adapter.mcpServers).toBe(servers);
    expect(await fsp.readdir(adapter.cwd)).toEqual([]);
    expect(adapter).not.toHaveProperty("mcpConfigPath");
    expect(adapter).not.toHaveProperty("env");
    await Promise.all([adapter.cleanup(), adapter.cleanup()]);
    expect(cleanup).toHaveBeenCalledOnce();
    await expect(fsp.stat(adapter.cwd)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("declares supported surfaces and resolves them through the shared helper", () => {
    const harness = { harness: "cursor", supportedToolSurfaces: CURSOR_TOOL_SURFACES };
    expect(CURSOR_TOOL_SURFACES).toEqual([
      "stagehand_facade",
      "stagehand_facade_legacy",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
    expect(resolveToolSurface(harness, undefined)).toBe("stagehand_facade");
    expect(resolveToolSurface(harness, "stagehand_facade")).toBe("stagehand_facade");
    expect(resolveToolSurface(harness, "playwright_mcp")).toBe("playwright_mcp");
    expect(resolveToolSurface(harness, "chrome_devtools_mcp")).toBe("chrome_devtools_mcp");
    expect(() => resolveToolSurface(harness, "browse_cli")).toThrow(
      /stagehand_facade.*playwright_mcp.*chrome_devtools_mcp.*browse_cli/,
    );
    expect(() => resolveToolSurface(harness, "stagehand_code")).toThrow(
      /stagehand_facade.*playwright_mcp.*chrome_devtools_mcp.*stagehand_code/,
    );
  });

  it("matches tolerant Cursor MCP tool names", () => {
    const matches = (name: string) => isCursorMountToolName(["stagehand"], name);
    for (const name of [
      "stagehand.run",
      "stagehand__run",
      "mcp__stagehand__run",
      "stagehand",
      "stagehand:run",
    ]) {
      expect(matches(name)).toBe(true);
    }
    for (const name of ["shell", "read", "playwright.click", "mcp__stagehand_extra__run"]) {
      expect(matches(name)).toBe(false);
    }
  });
});
