import { describe, expect, it } from "vitest";
import {
  buildCodexMcpServers,
  buildIsolatedCodexEnv,
  CODEX_MCP_TOOLS_APPROVAL_MODE,
} from "../../framework/codexToolAdapter.js";

describe("codex tool adapter", () => {
  it("pre-approves tools on every runner-mounted MCP server", () => {
    const servers = buildCodexMcpServers("playwright_mcp", {
      playwright: { command: "node", args: ["server.js"] },
    });
    expect(servers.playwright).toMatchObject({
      command: "node",
      args: ["server.js"],
      default_tools_approval_mode: CODEX_MCP_TOOLS_APPROVAL_MODE,
    });
  });

  it("adds facade timeouts on top of the approval mode for facade surfaces", () => {
    const servers = buildCodexMcpServers("stagehand_facade", {
      stagehand: { command: "node", args: ["-e", "relay"], env: { PORT: "1" } },
    });
    expect(servers.stagehand).toEqual({
      command: "node",
      args: ["-e", "relay"],
      env: { PORT: "1" },
      default_tools_approval_mode: "approve",
      startup_timeout_sec: 60,
      tool_timeout_sec: 300,
    });
  });

  it("points CODEX_HOME at the per-run directory and drops the inherited one", () => {
    const env = buildIsolatedCodexEnv(
      { PATH: "/usr/bin", CODEX_HOME: "/Users/someone/.codex", UNSET: undefined },
      "/tmp/run/.codex-home",
    );
    expect(env).toEqual({ PATH: "/usr/bin", CODEX_HOME: "/tmp/run/.codex-home" });
  });
});
