import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildCodexMcpServers,
  buildIsolatedCodexEnv,
  CODEX_MCP_TOOLS_APPROVAL_MODE,
  prepareCodexToolAdapter,
} from "../../framework/codexToolAdapter.js";
import { EvalLogger } from "../../logger.js";
import { startAgentToolRuntime } from "../../framework/agentToolRuntime.js";
import { prepareBrowseCliHarnessAdapter } from "../../framework/claudeCodeToolAdapter.js";

vi.mock("../../framework/agentToolRuntime.js", () => ({ startAgentToolRuntime: vi.fn() }));
vi.mock("../../framework/claudeCodeToolAdapter.js", () => ({
  prepareBrowseCliHarnessAdapter: vi.fn(),
}));
afterEach(() => vi.unstubAllEnvs());

describe("codex tool adapter", () => {
  it.each(["stagehand_facade", "browse_cli"] as const)(
    "rejects invalid effort before starting the %s browser",
    async (toolSurface) => {
      vi.stubEnv("EVAL_CODEX_REASONING_EFFORT", "unsupported");
      await expect(
        prepareCodexToolAdapter({
          toolSurface,
          environment: "LOCAL",
          plan: {
            dataset: "webvoyager",
            taskId: "smoke",
            startUrl: "https://example.com",
            instruction: "Read the page",
          },
          logger: new EvalLogger(false),
        }),
      ).rejects.toThrow(/EVAL_CODEX_REASONING_EFFORT must be one of/);
      expect(startAgentToolRuntime).not.toHaveBeenCalled();
      expect(prepareBrowseCliHarnessAdapter).not.toHaveBeenCalled();
    },
  );
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
