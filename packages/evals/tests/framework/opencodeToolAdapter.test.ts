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
        stagehand: {
          type: "local",
          enabled: true,
          command: ["node", "server.mjs"],
          environment: { TOKEN: "value" },
        },
      },
      tools: { "*": false, "stagehand_*": true },
      permission: { "*": "deny", "stagehand_*": "allow" },
    });
  });

  it("matches OpenCode MCP tool identities", () => {
    for (const name of ["stagehand_run", "stagehand.run", "mcp__stagehand__run"]) {
      expect(isOpenCodeMountToolName(["stagehand"], name)).toBe(true);
    }
    expect(isOpenCodeMountToolName(["stagehand"], "bash")).toBe(false);
  });
});
