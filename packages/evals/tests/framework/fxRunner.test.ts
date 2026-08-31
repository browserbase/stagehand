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
        browserSession: { provider: "local" },
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

  it("grades the agent's conclusion, not its narration, when fx joins every assistant turn", async () => {
    // Mirrors the observed events.jsonl shape: tool steps carrying opening and
    // interstitial narration, then a committed turn whose assistant text is
    // the structured report. fx's `ask --json` output joins all of them.
    const narration = "I’ll open AirAsia’s booking flow and inspect the seat price.";
    const interstitial = "No results rendered; retrying with direct flights only.";
    const report =
      '{"success":true,"summary":"Searched AirAsia.","finalAnswer":"No direct flights were available."}';
    const toolStep = (assistant: string, id: string) => ({
      assistant,
      tool_calls: [{ id, name: "mcp_stagehand_run", arguments_json: '{"code":"1"}' }],
      tool_results: [
        { tool_call_id: id, tool_name: "mcp_stagehand_run", status: "success", output: "{}" },
      ],
    });
    const events = JSON.stringify({
      kind: "history_turn_committed",
      payload: {
        total_input_tokens: 42,
        total_output_tokens: 8,
        turn: {
          kind: "completed",
          assistant: report,
          terminal_reason: "completed",
          execution: {
            schema_version: 3,
            tool_steps: [
              toolStep(narration, "c1"),
              toolStep("", "c2"),
              toolStep(interstitial, "c3"),
            ],
          },
        },
      },
    });
    const logger = new EvalLogger(false);
    const result = await runFxAgent({
      plan,
      model: "openai/gpt-5.6-sol" as AvailableModel,
      logger,
      toolAdapter: {
        toolSurface: "stagehand_facade",
        startupProfile: "tool_launch_local",
        browserSession: { provider: "local" },
        cwd: "/fake/workspace",
        home: "/fake/home",
        env: { PATH: "/bin" },
        promptInstructions: "Use mcp_stagehand_run.",
        mcpServerNames: ["stagehand"],
        observedToolMatcher: (name) => name.startsWith("mcp_"),
        cleanup: async () => {},
      },
      // Malformed rubric: the trajectory is still built and traced before the
      // verifier integration fails, which is what this test inspects.
      verifier: {
        v3: {} as never,
        taskSpec: { id: "wv-fx-1", instruction: plan.instruction, precomputedRubric: {} as never },
        dataset: "webvoyager",
      },
      runProcess: async () => ({
        stdout: JSON.stringify({
          output: `${narration}\n\n${interstitial}\n\n${report}`,
          exit_code: 0,
          session_id: "fx-2",
        }),
        stderr: "",
        exitCode: 0,
      }),
      store: {
        waitForSessionDir: async () => "/fake/session",
        readEventsJsonl: async () => events,
      },
    });

    expect(result._success).toBe(true);
    expect(result.finalAnswer).toBe("No direct flights were available.");
    expect(result.reasoning).toBe("Searched AirAsia.");
    const messages = (result.logs ?? []).map((line) => line.message);
    expect(messages).toContain("step 1 · think · " + narration);
    expect(messages).toContain("step 3 · think · " + interstitial);
    expect(messages).toContain("answer · No direct flights were available.");
    expect(messages.some((message) => message.startsWith("answer · I’ll open"))).toBe(false);
  });

  it("returns a failed task result with sdk_error status when fx cannot start", async () => {
    const result = await runFxAgent({
      plan,
      model: "openai/gpt-5.6-sol" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: {
        toolSurface: "stagehand_facade",
        startupProfile: "tool_launch_local",
        browserSession: { provider: "local" },
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
});
