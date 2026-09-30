import { describe, expect, it, vi } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  MASTRACODE_PROTOCOL_VERSION,
  type MastracodeDriverRequest,
  type MastracodeProcessRunner,
} from "@browserbasehq/stagehand-integrations-mastracode-sdk";
import { EvalsError } from "../../errors.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import {
  buildMastracodePrompt,
  readMastracodeMaxSteps,
  readMastracodeStartupTimeoutMs,
  readMastracodeThinkingLevel,
  readMastracodeTimeoutMs,
  runMastracodeAgent,
  toMastracodeModelId,
} from "../../framework/mastracodeRunner.js";
import type { PreparedMastracodeToolAdapter } from "../../framework/mastracodeToolAdapter.js";
import type { TaskResult } from "../../framework/types.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-mc-1",
  startUrl: "https://example.com",
  instruction: "Find the heading",
};

const KEYS = { ANTHROPIC_API_KEY: "sk-ant-test", OPENAI_API_KEY: "sk-test" };
const REPORT = '{"success":true,"summary":"Read the page.","finalAnswer":"Example Domain"}';

const ev = (event: Record<string, unknown>) =>
  JSON.stringify({ v: MASTRACODE_PROTOCOL_VERSION, ...event });

function stepUsage(
  prompt: number,
  cached: number | undefined,
  write: number | undefined,
  out: number,
) {
  return {
    promptTokens: prompt,
    completionTokens: out,
    totalTokens: prompt + out,
    ...(cached !== undefined && { cachedInputTokens: cached }),
    ...(write !== undefined && { cacheCreationInputTokens: write }),
  };
}

/** A three-step run: two facade calls with narration, then the structured report. */
function completedRun(): string[] {
  const tools = ["stagehand_run", "stagehand_snapshot", "stagehand_screenshot"];
  return [
    ev({ type: "ready", mastracodeVersion: "0.41.0", codeSdkVersion: "1.8.0", mcpTools: tools }),
    ev({
      type: "request",
      index: 1,
      role: "agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      toolNames: tools,
      cacheBreakpoints: 2,
    }),
    ev({
      type: "tool_start",
      toolCallId: "t1",
      toolName: "stagehand_run",
      args: { code: "await page.goto(startUrl)" },
      reasoning: "I'll open the page.",
    }),
    ev({
      type: "tool_end",
      toolCallId: "t1",
      result: { content: [{ type: "text", text: "ok" }] },
      isError: false,
      denied: false,
    }),
    ev({
      type: "step",
      index: 1,
      usage: stepUsage(5000, 0, 4800, 40),
      hadToolCalls: true,
      text: "I'll open the page.",
    }),
    ev({
      type: "request",
      index: 2,
      role: "agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      toolNames: tools,
      cacheBreakpoints: 2,
    }),
    ev({
      type: "tool_start",
      toolCallId: "t2",
      toolName: "stagehand_snapshot",
      args: {},
      reasoning: "Now reading it.",
    }),
    ev({
      type: "tool_end",
      toolCallId: "t2",
      result: { content: [{ type: "text", text: "heading: Example Domain" }] },
      isError: false,
      denied: false,
    }),
    ev({
      type: "step",
      index: 2,
      usage: stepUsage(6000, 4800, 1100, 30),
      hadToolCalls: true,
      text: "Now reading it.",
    }),
    ev({
      type: "request",
      index: 3,
      role: "agent",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      toolNames: tools,
      cacheBreakpoints: 2,
    }),
    ev({
      type: "step",
      index: 3,
      usage: stepUsage(6200, 5900, 250, 60),
      hadToolCalls: false,
      text: REPORT,
    }),
    ev({
      type: "request_usage",
      index: 4,
      role: "side",
      model: "claude-haiku-4-5",
      usage: {
        inputTokens: 900,
        cachedInputTokens: 0,
        cacheCreationInputTokens: 0,
        outputTokens: 12,
      },
    }),
    ev({
      type: "done",
      status: "completed",
      finalText: REPORT,
      steps: 3,
      sessionTokenUsage: stepUsage(17_200, 10_700, 6150, 130),
    }),
  ];
}

function toolAdapter(
  overrides: Partial<PreparedMastracodeToolAdapter> = {},
): PreparedMastracodeToolAdapter {
  return {
    toolSurface: "stagehand_facade",
    startupProfile: "tool_launch_local",
    paths: { root: "/r", home: "/r/home", appDataDir: "/r/appdata", workspace: "/r/workspace" },
    env: { PATH: "/bin", HOME: "/r/home", MASTRA_APP_DATA_DIR: "/r/appdata" },
    mcpServers: { stagehand: { command: "node", args: ["bridge.mjs"], env: {} } },
    facadeToolNames: ["stagehand_run", "stagehand_snapshot", "stagehand_screenshot"],
    promptInstructions: "Use stagehand_run, stagehand_snapshot and stagehand_screenshot.",
    browserSession: { provider: "local" },
    observedToolMatcher: (name) => name.startsWith("stagehand_"),
    cleanup: async () => {},
    ...overrides,
  };
}

async function run(
  lines: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    model?: string;
    exitCode?: number | null;
    adapter?: Partial<PreparedMastracodeToolAdapter>;
    runProcess?: MastracodeProcessRunner;
  } = {},
): Promise<{ result: TaskResult; request?: MastracodeDriverRequest }> {
  let request: MastracodeDriverRequest | undefined;
  const runProcess: MastracodeProcessRunner =
    options.runProcess ??
    (async (input) => {
      request = JSON.parse(input.stdin) as MastracodeDriverRequest;
      for (const line of lines) input.onStdoutLine(line);
      return { exitCode: options.exitCode === undefined ? 0 : options.exitCode, stderr: "" };
    });
  const result = await runMastracodeAgent({
    plan,
    model: (options.model ?? "anthropic/claude-sonnet-4-6") as AvailableModel,
    logger: new EvalLogger(false),
    toolAdapter: toolAdapter(options.adapter),
    runProcess,
    driverPath: "/opt/driver.mjs",
    env: { ...KEYS, ...options.env },
  });
  return { result, request };
}

const metricsOf = (result: TaskResult) => result.metrics as Record<string, { value: number }>;

describe("mastracode model routing", () => {
  it("passes anthropic/* through on the direct cached route", () => {
    expect(toMastracodeModelId("anthropic/claude-sonnet-4-6", KEYS)).toEqual({
      modelId: "anthropic/claude-sonnet-4-6",
      cacheRoute: "anthropic_direct",
    });
    expect(toMastracodeModelId("claude-opus-5", KEYS)).toEqual({
      modelId: "anthropic/claude-opus-5",
      cacheRoute: "anthropic_direct",
    });
    expect(toMastracodeModelId("openai/gpt-5.4", KEYS)).toEqual({
      modelId: "openai/gpt-5.4",
      cacheRoute: "openai_automatic",
    });
  });

  it("rejects uncached routes unless explicitly allowed", () => {
    expect(() => toMastracodeModelId("vercel/anthropic/claude-sonnet-4-6", KEYS)).toThrow(
      EvalsError,
    );
    expect(() => toMastracodeModelId("mastra/anthropic/claude-sonnet-4-6", KEYS)).toThrow(
      /EVAL_MASTRACODE_ALLOW_UNCACHED_ROUTES=1/u,
    );
    expect(
      toMastracodeModelId("google/gemini-3.5-flash", {
        ...KEYS,
        EVAL_MASTRACODE_ALLOW_UNCACHED_ROUTES: "1",
      }),
    ).toEqual({ modelId: "google/gemini-3.5-flash", cacheRoute: "none" });
  });

  it("refuses anthropic/* without an API key instead of falling back to OAuth", () => {
    expect(() => toMastracodeModelId("anthropic/claude-sonnet-4-6", {})).toThrow(
      /ANTHROPIC_API_KEY/u,
    );
    expect(() => toMastracodeModelId("openai/gpt-5.4", {})).toThrow(/OPENAI_API_KEY/u);
  });
});

describe("mastracode runner configuration", () => {
  it("resolves the step budget with the shared precedence", () => {
    expect(readMastracodeMaxSteps("webvoyager", {})).toBe(50);
    expect(readMastracodeMaxSteps("hardbenchmark", {})).toBe(100);
    expect(readMastracodeMaxSteps("hardbenchmark", { AGENT_EVAL_MAX_STEPS: "30" })).toBe(30);
    expect(
      readMastracodeMaxSteps("hardbenchmark", {
        AGENT_EVAL_MAX_STEPS: "30",
        EVAL_MASTRACODE_MAX_STEPS: "8",
      }),
    ).toBe(8);
  });

  it("validates the thinking level and leaves it unset by default", () => {
    expect(readMastracodeThinkingLevel({})).toBeUndefined();
    expect(readMastracodeThinkingLevel({ EVAL_MASTRACODE_THINKING_LEVEL: "High" })).toBe("high");
    expect(() => readMastracodeThinkingLevel({ EVAL_MASTRACODE_THINKING_LEVEL: "turbo" })).toThrow(
      EvalsError,
    );
  });

  it("defaults the wall-clock timeout to one hour", () => {
    expect(readMastracodeTimeoutMs({})).toBe(3_600_000);
    expect(readMastracodeTimeoutMs({ EVAL_MASTRACODE_TIMEOUT_MS: "120000" })).toBe(120_000);
    expect(readMastracodeTimeoutMs({ EVAL_MASTRACODE_TIMEOUT_MS: "-1" })).toBe(3_600_000);
  });

  it("defaults the startup budget to two minutes", () => {
    expect(readMastracodeStartupTimeoutMs({})).toBe(120_000);
    expect(readMastracodeStartupTimeoutMs({ EVAL_MASTRACODE_STARTUP_TIMEOUT_MS: "5000" })).toBe(
      5_000,
    );
    expect(readMastracodeStartupTimeoutMs({ EVAL_MASTRACODE_STARTUP_TIMEOUT_MS: "0" })).toBe(
      120_000,
    );
  });

  it("builds a structured-output task prompt with the tool instructions", () => {
    const prompt = buildMastracodePrompt(plan, "Use stagehand_run.");
    expect(prompt).toContain("Find the heading");
    expect(prompt).toContain("Use stagehand_run.");
    expect(prompt).toContain('"success": boolean');
  });
});

describe("runMastracodeAgent", () => {
  it("sends the eval policy once, as host instructions, with the resolved request", async () => {
    const { result, request } = await run(completedRun(), {
      env: { EVAL_MASTRACODE_MAX_STEPS: "12", EVAL_MASTRACODE_THINKING_LEVEL: "low" },
    });
    expect(request?.hostInstructions).toBe(EVAL_SYSTEM_PROMPT);
    expect(request?.prompt).not.toContain(EVAL_SYSTEM_PROMPT);
    expect(request?.prompt).toContain("Find the heading");
    expect(request).toMatchObject({
      modelId: "anthropic/claude-sonnet-4-6",
      stepBudget: 12,
      thinkingLevel: "low",
      timeoutMs: 3_600_000,
      startupTimeoutMs: 120_000,
      facadeToolNames: ["stagehand_run", "stagehand_snapshot", "stagehand_screenshot"],
      workspaceDir: "/r/workspace",
      appDataDir: "/r/appdata",
      homeDir: "/r/home",
    });
    expect(result.harnessConfiguration).toMatchObject({
      systemPromptMode: "native",
      stepBudget: 12,
      stepBudgetUnit: "model_steps",
      mastracodeModelId: "anthropic/claude-sonnet-4-6",
      cacheRoute: "anthropic_direct",
      requestedThinkingLevel: "low",
      codeSdkVersion: "1.8.0",
      requestTools: ["stagehand_run", "stagehand_screenshot", "stagehand_snapshot"],
      sideCallModels: ["claude-haiku-4-5"],
    });
    expect(result.harnessImplementation).toEqual({
      name: "mastracode",
      version: 1,
      sdkVersion: "0.41.0",
    });
  });

  it("grades the last message, not the concatenated narration", async () => {
    const { result } = await run(completedRun());
    expect(result._success).toBe(true);
    expect(result.harnessStatus).toBe("completed");
    expect(result.terminationReason).toBe("completed");
    expect(result.finalAnswer).toBe("Example Domain");
    expect(result.reasoning).toBe("Read the page.");
  });

  it("sums step usage without double-counting cached input and prices cache writes", async () => {
    const { result } = await run(completedRun());
    const metrics = metricsOf(result);
    expect(result.usageConvention).toBe("openai_cached_subset");
    expect(metrics.harness_input_tokens.value).toBe(17_200);
    expect(metrics.harness_cached_input_tokens.value).toBe(10_700);
    expect(metrics.harness_cache_creation_input_tokens.value).toBe(6150);
    expect(metrics.harness_output_tokens.value).toBe(130);
    expect(metrics.usage_input_total.value).toBe(17_200);
    expect(metrics.usage_input_cached.value).toBe(10_700);
    expect(metrics.mastracode_steps.value).toBe(3);
    expect(metrics.mastracode_tool_calls.value).toBe(2);
    expect(metrics.mastracode_model_requests.value).toBe(3);
    expect(metrics.mastracode_cache_breakpoints_per_request.value).toBe(2);
    expect(metrics.mastracode_cache_hit_ratio.value).toBeCloseTo(10_700 / 17_200);
    expect(metrics.mastracode_side_requests.value).toBe(1);
    expect(metrics.mastracode_side_input_tokens.value).toBe(900);
    expect(result.cost_source).toBe("computed");
    expect(result.billing_channel).toBe("anthropic_api");
    // uncached 350·$3 + cached 10,700·$0.30 + write 6,150·$3.75 + out 130·$15, per million.
    expect(result.cost_usd).toBeCloseTo((350 * 3 + 10_700 * 0.3 + 6150 * 3.75 + 130 * 15) / 1e6, 5);
  });

  it("keeps an observed zero cache bucket at zero and a missing one absent", async () => {
    const lines = [
      ev({
        type: "step",
        index: 1,
        usage: stepUsage(1000, 0, undefined, 10),
        hadToolCalls: false,
        text: REPORT,
      }),
      ev({ type: "done", status: "completed", finalText: REPORT, steps: 1 }),
    ];
    const metrics = metricsOf((await run(lines)).result);
    expect(metrics.harness_cached_input_tokens.value).toBe(0);
    expect(metrics.harness_cache_creation_input_tokens).toBeUndefined();
    expect(metrics.mastracode_cache_hit_ratio.value).toBe(0);
  });

  it("records usage as unreported when the driver saw no model step", async () => {
    const { result } = await run([
      ev({
        type: "done",
        status: "error",
        stopReason: "mcp_unavailable",
        error: "MCP tools missing",
        finalText: "",
        steps: 0,
      }),
    ]);
    expect(result.usageConvention).toBe("unreported");
    expect(result.cost_usd).toBeUndefined();
    expect(result.cost_source).toBe("unavailable");
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBe("mcp_unavailable");
  });

  it("records a startup timeout as sdk_error / startup_timeout", async () => {
    const { result } = await run([
      ev({
        type: "done",
        status: "error",
        stopReason: "startup_timeout",
        error: "mastracode startup timed out after 120000 ms (mcp_connect)",
        finalText: "",
        steps: 0,
      }),
    ]);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBe("startup_timeout");
    expect(result._success).toBe(false);
  });

  it("maps a budget stop to the step_budget termination", async () => {
    const lines = completedRun().slice(0, 5);
    lines.push(
      ev({ type: "done", status: "max_turns", finalText: "I'll open the page.", steps: 1 }),
    );
    const { result } = await run(lines);
    expect(result.harnessStatus).toBe("max_turns");
    expect(result.terminationReason).toBe("step_budget");
    expect(result._success).toBe(false);
  });

  it("does not trust a success report from a failed session", async () => {
    const { result } = await run([
      ev({
        type: "step",
        index: 1,
        usage: stepUsage(100, 0, 0, 5),
        hadToolCalls: false,
        text: REPORT,
      }),
      ev({
        type: "done",
        status: "error",
        stopReason: "overloaded",
        error: "overloaded",
        finalText: REPORT,
        steps: 1,
      }),
    ]);
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.finalAnswer).toBeUndefined();
    expect(result.error).toBe("overloaded");
  });

  it("fails the run when the model was offered a non-facade tool", async () => {
    const { result } = await run([
      ev({ type: "violation", kind: "unexpected_tool", names: ["web_search"] }),
      ev({
        type: "done",
        status: "error",
        stopReason: "tool_isolation_violation",
        finalText: REPORT,
        steps: 0,
      }),
    ]);
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBe("tool_isolation_violation");
    expect(result.terminationReason).toBe("sdk_error");
  });

  it.each([
    ["timeout", "timeout", "sdk_error"],
    ["aborted", "aborted", "aborted"],
  ] as const)("maps a %s driver stop", async (status, stopReason, termination) => {
    const { result } = await run([ev({ type: "done", status, finalText: "", steps: 0 })]);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBe(stopReason);
    expect(result.terminationReason).toBe(termination);
  });

  it("reports a driver spawn failure as sdk_error", async () => {
    const { result } = await run([], {
      runProcess: async () => ({ exitCode: null, stderr: "spawn node ENOENT" }),
    });
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBe(
      "driver_exited_without_result (code null): spawn node ENOENT",
    );
    expect(result.error).toContain("spawn node ENOENT");
  });

  it("records browser loss over the driver's own status", async () => {
    const { result } = await run(completedRun(), {
      adapter: { browserSessionLoss: () => ({ cause: "cdp_closed" }) as never },
    });
    expect(result._success).toBe(false);
    expect(result.harnessStopReason).toBe("browser_session_lost");
    expect(result.terminationReason).toBe("browser_session_lost");
  });

  it("records a probe observation after each facade tool result", async () => {
    const recordObservation = vi.fn();
    await run(completedRun(), { adapter: { recordObservation } });
    expect(recordObservation).toHaveBeenCalledTimes(2);
  });

  it("rejects an invalid thinking level before spawning", async () => {
    const runProcess = vi.fn();
    await expect(
      run([], {
        env: { EVAL_MASTRACODE_THINKING_LEVEL: "turbo" },
        runProcess: runProcess as never,
      }),
    ).rejects.toThrow(/EVAL_MASTRACODE_THINKING_LEVEL must be one of/u);
    expect(runProcess).not.toHaveBeenCalled();
  });

  it("rejects an uncached model route before spawning", async () => {
    const runProcess = vi.fn();
    await expect(
      run([], { model: "vercel/anthropic/claude-sonnet-4-6", runProcess: runProcess as never }),
    ).rejects.toThrow(EvalsError);
    expect(runProcess).not.toHaveBeenCalled();
  });
});
