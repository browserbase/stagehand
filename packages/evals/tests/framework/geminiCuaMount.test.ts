import { geminiCuaHarness } from "../../framework/benchHarness.js";
import { getCoreTool, listCoreRunnableTools } from "../../core/tools/registry.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  prepareGeminiCuaToolAdapter,
  GEMINI_CUA_TOOL_INSTRUCTIONS,
} from "../../framework/geminiCuaToolAdapter.js";
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

describe("Gemini native mount ownership", () => {
  it("uses the supplied browser and typed bridge, preserves loss metadata, and cleans up once", async () => {
    const cleanup = vi.fn(async () => {});
    const loss = (): undefined => undefined;
    const callTool = vi.fn(async () => ({
      content: [{ type: "text", text: "{}" }],
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
    const adapter = await prepareGeminiCuaToolAdapter(input);
    expect(adapter.promptInstructions).toBe(GEMINI_CUA_TOOL_INSTRUCTIONS);
    expect(adapter.promptInstructions).not.toContain("exactly three tools");
    expect(adapter.promptInstructions).not.toContain("run, snapshot, screenshot");
    expect(adapter.browserSession).toBe(browserSession);
    expect(adapter.browserSessionLoss).toBe(loss);
    expect(
      (
        await adapter.executor.execute(
          "navigate",
          { url: "https://fixture.test" },
          { toolUseId: "read" },
        )
      ).isError,
    ).not.toBe(true);
    expect(callTool).toHaveBeenCalledWith(
      "run",
      { code: expect.stringContaining('page.goto("https://fixture.test"') },
      { timeoutMs: 90_000 },
    );
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
    await expect(prepareGeminiCuaToolAdapter(input)).rejects.toThrow(
      "does not expose runner-side tool calls",
    );
    expect(cleanup).toHaveBeenCalledOnce();
  });
});

it("registers native Gemini only on the facade-backed Google computer-use surface", () => {
  expect(geminiCuaHarness.supportedToolSurfaces).toEqual(["google_computer_use"]);
  expect(geminiCuaHarness.defaultModels).toEqual(["google/gemini-3.8-flash"]);
  expect(geminiCuaHarness.execute).toBeTypeOf("function");
  expect(getCoreTool("google_computer_use").id).toBe("google_computer_use");
  expect(listCoreRunnableTools()).not.toContain("google_computer_use");
});
