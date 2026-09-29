import { describe, expect, it } from "vitest";
import {
  buildOpenCodeMcpConfig,
  isOpenCodeMountToolName,
  OPENCODE_TOOL_SURFACES,
} from "../../framework/opencodeToolAdapter.js";

describe("OpenCode tool adapter helpers", () => {
  it("converts shared MCP launch specs and denies built-ins", () => {
    expect(OPENCODE_TOOL_SURFACES).toEqual([
      "stagehand_facade",
      "playwright_mcp",
      "chrome_devtools_mcp",
    ]);
    expect(
      buildOpenCodeMcpConfig({
        stagehand: { command: "node", args: ["server.mjs"], env: { TOKEN: "value" } },
      }),
    ).toEqual({
      mcp: {
        servers: {
          stagehand: {
            type: "local",
            codemode: false,
            command: ["node", "server.mjs"],
            environment: { TOKEN: "value" },
          },
        },
      },
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "stagehand_*", resource: "*", effect: "allow" },
      ],
    });
  });

  it("matches OpenCode MCP tool identities", () => {
    for (const name of ["stagehand_run", "stagehand.run", "mcp__stagehand__run"]) {
      expect(isOpenCodeMountToolName(["stagehand"], name)).toBe(true);
    }
    expect(isOpenCodeMountToolName(["stagehand"], "bash")).toBe(false);
  });

  it("mounts all supported MCP surfaces with direct tools and ordered permissions", () => {
    for (const server of ["stagehand", "playwright", "chrome-devtools"]) {
      const config = buildOpenCodeMcpConfig({
        [server]: { command: "node", args: ["server.mjs"] },
      });
      expect(config.mcp.servers[server]).toMatchObject({ codemode: false });
      expect(config.permissions).toEqual([
        { action: "*", resource: "*", effect: "deny" },
        { action: `${server}_*`, resource: "*", effect: "allow" },
      ]);
      expect(isOpenCodeMountToolName([server], `${server}_browser_snapshot`)).toBe(true);
    }
  });
});
