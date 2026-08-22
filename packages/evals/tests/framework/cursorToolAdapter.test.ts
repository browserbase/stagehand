import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCursorMcpConfig,
  isCursorMountToolName,
  resolveCursorStartupProfile,
  resolveCursorToolSurface,
  writeCursorWorkspace,
} from "../../framework/cursorToolAdapter.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })));
});

describe("cursor tool adapter helpers", () => {
  it("resolves supported surfaces and startup profiles", () => {
    expect(resolveCursorToolSurface()).toBe("stagehand_facade");
    expect(resolveCursorToolSurface("playwright_mcp")).toBe("playwright_mcp");
    expect(resolveCursorToolSurface("chrome_devtools_mcp")).toBe("chrome_devtools_mcp");
    expect(() => resolveCursorToolSurface("browse_cli")).toThrow(
      /stagehand_facade, playwright_mcp, or chrome_devtools_mcp.*browse_cli/,
    );
    expect(() => resolveCursorToolSurface("stagehand_code")).toThrow(
      /stagehand_facade, playwright_mcp, or chrome_devtools_mcp.*stagehand_code/,
    );
    expect(resolveCursorStartupProfile("stagehand_facade", "LOCAL")).toBe("tool_launch_local");
    expect(resolveCursorStartupProfile("stagehand_facade", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(resolveCursorStartupProfile("playwright_mcp", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveCursorStartupProfile("chrome_devtools_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
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
    for (const name of ["shell", "read", "playwright.click"]) {
      expect(matches(name)).toBe(false);
    }
  });
});
