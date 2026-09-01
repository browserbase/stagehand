import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import { EvalLogger } from "../../logger.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { buildFxPrompt, parseFxResult, runFxAgent } from "../../framework/fxRunner.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-fx-1",
  startUrl: "https://example.com",
  instruction: "Find the heading",
};

describe("fx runner helpers", () => {
  it("builds a browser task prompt with structured result instructions", () => {
    const prompt = buildFxPrompt(plan, "Use mcp_stagehand_snapshot.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-fx-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find the heading");
    expect(prompt).toContain("mcp_stagehand_snapshot");
    expect(prompt).toContain('"success": boolean');
  });

  it("parses direct and marker JSON results", () => {
    expect(parseFxResult('{"success":true,"summary":"done","finalAnswer":"Example"}')).toEqual({
      success: true,
      summary: "done",
      finalAnswer: "Example",
      raw: '{"success":true,"summary":"done","finalAnswer":"Example"}',
    });
    expect(
      parseFxResult('assistant text\nEVAL_RESULT: {"success":true,"summary":"done"}'),
    ).toMatchObject({ success: true, summary: "done" });
  });

  it("runs a fake fx session into a successful task result", async () => {
    const finalOutput = '{"success":true,"summary":"done","finalAnswer":"Example Domain"}';
    const events = JSON.stringify({
      kind: "history_turn_committed",
      payload: {
        total_input_tokens: 42,
        total_output_tokens: 8,
        turn: {
          kind: "completed",
          assistant: finalOutput,
          terminal_reason: "completed",
          execution: { schema_version: 3, tool_steps: [] },
        },
      },
    });
    const result = await runFxAgent({
      plan,
      model: "openai/gpt-5.6-sol" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: {
        toolSurface: "stagehand_facade",
        startupProfile: "tool_launch_local",
        cwd: "/fake/workspace",
        home: "/fake/home",
        env: { PATH: "/bin" },
        promptInstructions: "Use mcp_stagehand_snapshot.",
        mcpServerNames: ["stagehand"],
        cleanup: async () => {},
      },
      runProcess: async ({ args, stdin }) => {
        expect(args).toEqual(["ask", "--json", "--auto"]);
        expect(stdin).toContain("Find the heading");
        return {
          stdout: JSON.stringify({ output: finalOutput, exit_code: 0, session_id: "fx-1" }),
          stderr: "",
          exitCode: 0,
        };
      },
      store: {
        waitForSessionDir: async () => "/fake/session",
        readEventsJsonl: async () => events,
        readUsageSnapshot: async () => ({
          snapshot: {
            input_tokens: 42,
            output_tokens: 8,
            cache_read_tokens: 5,
            reasoning_tokens: 2,
          },
        }),
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(result._success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.fxStatus).toBe("completed");
    expect(result.harnessStatus).toBe("completed");
    expect(result.finalAnswer).toBe("Example Domain");
    expect(metrics.fx_input_tokens.value).toBe(42);
    expect(metrics.harness_input_tokens.value).toBe(42);
    expect(metrics.harness_output_tokens.value).toBe(8);
    expect(metrics.harness_cached_input_tokens.value).toBe(5);
    expect(metrics.harness_reasoning_output_tokens.value).toBe(2);
    expect(metrics.fx_total_tokens.value).toBe(57);
    expect(metrics.harness_total_tokens.value).toBe(57);
    expect(metrics.harness_cost_usd).toBeUndefined();
  });

  it("returns a failed task result with sdk_error status when fx cannot start", async () => {
    const result = await runFxAgent({
      plan,
      model: "openai/gpt-5.6-sol" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: {
        toolSurface: "stagehand_facade",
        startupProfile: "tool_launch_local",
        cwd: "/fake/workspace",
        home: "/fake/home",
        env: { PATH: "/bin" },
        promptInstructions: "Use mcp_stagehand_snapshot.",
        mcpServerNames: ["stagehand"],
        cleanup: async () => {},
      },
      runProcess: async () => {
        throw new Error("MissingCredentials");
      },
      store: {
        waitForSessionDir: async () => undefined,
        readEventsJsonl: async () => "",
      },
    });

    expect(result._success).toBe(false);
    expect(result.fxStatus).toBe("sdk_error");
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBeDefined();
    expect(String(result.error)).not.toBe("");
  });

  it("does not trust structured success output from a failed fx session", async () => {
    const result = await runFxAgent({
      plan,
      model: "openai/gpt-5.6-sol" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: {
        toolSurface: "stagehand_facade",
        startupProfile: "tool_launch_local",
        cwd: "/fake/workspace",
        home: "/fake/home",
        env: { PATH: "/bin" },
        promptInstructions: "Use mcp_stagehand_snapshot.",
        mcpServerNames: ["stagehand"],
        cleanup: async () => {},
      },
      runProcess: async () => ({
        stdout: JSON.stringify({
          output: '{"success":true,"summary":"untrusted"}',
          error: "provider failed",
          exit_code: 1,
        }),
        stderr: "",
        exitCode: 1,
      }),
      store: {
        waitForSessionDir: async () => undefined,
        readEventsJsonl: async () => "",
      },
    });

    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.reasoning).toBeUndefined();
  });
});
