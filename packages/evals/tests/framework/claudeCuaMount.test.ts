import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareClaudeCuaToolAdapter,
  CLAUDE_CUA_TOOL_INSTRUCTIONS,
} from "../../framework/claudeCuaToolAdapter.js";
import { startAgentToolRuntime } from "../../framework/agentToolRuntime.js";
import { EvalLogger } from "../../logger.js";

vi.mock("../../framework/agentToolRuntime.js", () => ({ startAgentToolRuntime: vi.fn() }));
afterEach(() => vi.unstubAllEnvs());

const input = {
  environment: "LOCAL" as const,
  plan: {
    dataset: "webvoyager" as const,
    taskId: "native-mount",
    startUrl: "https://fixture.test",
    instruction: "Finish the task.",
  },
  logger: new EvalLogger(false),
};

describe("Claude native mount ownership", () => {
  it("uses the supplied browser and typed bridge, preserves loss metadata, and cleans up once", async () => {
    const cleanup = vi.fn(async () => {});
    let currentLoss: { cause: string } | undefined;
    const loss = () => currentLoss;
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: '[0-1] button "Submit"' }],
    }));
    const browserSession = { provider: "local" as const, sessionId: "owned-fixture" };
    vi.mocked(startAgentToolRuntime).mockResolvedValue({
      browserSession,
      running: {
        agentMount: {
          via: "mcp",
          promptInstructions:
            "You control one persistent browser through exactly three tools: run, snapshot, screenshot.",
          mcpServers: {},
        },
        callTool,
        browserSessionLoss: loss,
      } as never,
      cleanup,
    });
    const adapter = await prepareClaudeCuaToolAdapter(input);
    expect(adapter.promptInstructions).toBe(CLAUDE_CUA_TOOL_INSTRUCTIONS);
    expect(adapter.promptInstructions).not.toContain("exactly three tools");
    expect(adapter.promptInstructions).not.toContain("run, snapshot, screenshot");
    expect(adapter.browserSession).toBe(browserSession);
    expect(adapter.browserSessionLoss).toBe(loss);
    expect(
      (await adapter.executor.execute("read_page", {}, { toolUseId: "read" })).isError,
    ).not.toBe(true);
    expect(callTool).toHaveBeenCalledWith(
      "snapshot",
      { includeIframes: true },
      { timeoutMs: 90_000 },
    );
    currentLoss = { cause: "closed" };
    await expect(
      adapter.executor.execute("read_page", {}, { toolUseId: "after-loss" }),
    ).rejects.toThrow("Browser session lost (confirmed by eval runner)");
    expect(callTool).toHaveBeenCalledOnce();
    await Promise.all([adapter.cleanup(), adapter.cleanup()]);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("closes the same runtime if it cannot expose native facade calls", async () => {
    const cleanup = vi.fn(async () => {});
    vi.mocked(startAgentToolRuntime).mockResolvedValue({
      browserSession: { provider: "local" },
      running: {} as never,
      cleanup,
    });
    await expect(prepareClaudeCuaToolAdapter(input)).rejects.toThrow(
      "does not expose runner-side tool calls",
    );
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
