import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCursorMcpConfig,
  CURSOR_TOOL_SURFACES,
  isCursorMountToolName,
  writeCursorWorkspace,
} from "../../framework/cursorToolAdapter.js";
import { resolveToolSurface } from "../../framework/harnesses/toolSurfaceResolution.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

describe("cursor tool adapter helpers", () => {
  it("declares supported surfaces and resolves them through the shared helper", () => {
    const harness = { harness: "cursor", supportedToolSurfaces: CURSOR_TOOL_SURFACES };
    expect(CURSOR_TOOL_SURFACES).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
    expect(resolveToolSurface(harness, undefined)).toBe("stagehand_facade");
    expect(resolveToolSurface(harness, "stagehand_facade")).toBe("stagehand_facade");
    expect(resolveToolSurface(harness, "playwright_mcp")).toBe("playwright_mcp");
    expect(resolveToolSurface(harness, "chrome_devtools_mcp")).toBe("chrome_devtools_mcp");
    expect(() => resolveToolSurface(harness, "browse_cli")).toThrow(
      /stagehand_facade, playwright_mcp, or chrome_devtools_mcp.*browse_cli/,
    );
    expect(() => resolveToolSurface(harness, "stagehand_code")).toThrow(
      /stagehand_facade, playwright_mcp, or chrome_devtools_mcp.*stagehand_code/,
    );
  });

  it("wraps MCP config without changing the server map", () => {
    const servers = { stagehand: { command: "node", args: ["server.mjs"] } };
    expect(buildCursorMcpConfig(servers)).toEqual({ mcpServers: servers });
    expect(buildCursorMcpConfig(servers).mcpServers).toBe(servers);
  });

  it("writes project MCP configuration", async () => {
    const cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "cursor-workspace-test-"));
    tempDirs.push(cwd);
    const servers = { stagehand: { command: "node", args: ["server.mjs"] } };
    const result = await writeCursorWorkspace(cwd, servers);
    expect(result.mcpConfigPath).toBe(path.join(cwd, ".cursor", "mcp.json"));
    expect(JSON.parse(await fsp.readFile(result.mcpConfigPath, "utf8"))).toEqual({
      mcpServers: servers,
    });
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
