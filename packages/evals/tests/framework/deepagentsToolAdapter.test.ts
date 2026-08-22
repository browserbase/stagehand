import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeDeepagentsMcpServers,
  resolveDeepagentsStartupProfile,
  resolveDeepagentsToolSurface,
  writeDeepagentsMcpConfig,
} from "../../framework/deepagentsToolAdapter.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => fsp.rm(dir, { recursive: true, force: true })),
  );
});

describe("Deep Agents tool adapter helpers", () => {
  it("resolves supported surfaces and startup profiles", () => {
    expect(resolveDeepagentsToolSurface()).toBe("stagehand_facade");
    expect(resolveDeepagentsToolSurface("playwright_mcp")).toBe("playwright_mcp");
    expect(resolveDeepagentsToolSurface("chrome_devtools_mcp")).toBe("chrome_devtools_mcp");
    expect(resolveDeepagentsStartupProfile("stagehand_facade", "LOCAL")).toBe("tool_launch_local");
    expect(resolveDeepagentsStartupProfile("stagehand_facade", "BROWSERBASE")).toBe(
      "tool_create_browserbase",
    );
    expect(resolveDeepagentsStartupProfile("playwright_mcp", "LOCAL")).toBe(
      "runner_provided_local_cdp",
    );
    expect(resolveDeepagentsStartupProfile("chrome_devtools_mcp", "BROWSERBASE")).toBe(
      "runner_provided_browserbase_cdp",
    );
    expect(() => resolveDeepagentsToolSurface("browse_cli")).toThrow(
      /supports --tool stagehand_facade, playwright_mcp, or chrome_devtools_mcp/,
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

  it("writes a Deep Agents MCP config", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "deepagents-config-test-"));
    temporaryDirectories.push(dir);
    const servers = { stagehand: { command: "node", args: ["server.js"] } };
    const configPath = await writeDeepagentsMcpConfig(dir, servers);
    expect(configPath).toBe(path.join(dir, "deepagents.mcp.json"));
    expect(JSON.parse(await fsp.readFile(configPath, "utf8"))).toEqual({ mcpServers: servers });
  });
});
