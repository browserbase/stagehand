import { describe, expect, it } from "vitest";
import {
  buildOpenCodeMcpConfig,
  isOpenCodeMountToolName,
} from "../../framework/opencodeToolAdapter.js";

describe("OpenCode tool adapter helpers", () => {
  it("converts shared MCP launch specs and denies built-ins", () => {
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
});
