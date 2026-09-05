import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { CursorProcessRunner } from "@browserbasehq/stagehand-integrations-cursor-sdk";
import {
  buildCursorPrompt,
  parseCursorResult,
  runCursorAgent,
} from "../../framework/cursorRunner.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Report the heading",
};

describe("cursor runner", () => {
  it("builds an MCP-only browser prompt", () => {
    const prompt = buildCursorPrompt(plan, "Use stagehand.run.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Report the heading");
    expect(prompt).toContain("Use stagehand.run.");
    expect(prompt).toContain("Your only browser access is the MCP server");
    expect(prompt).toContain("Do not edit repository files.");
    expect(prompt).toContain("EVAL_RESULT:");
    expect(prompt).toContain('"success": boolean');
  });

  it("parses direct, marked, and fenced JSON results", () => {
    expect(parseCursorResult('{"success":true,"summary":"done","finalAnswer":"ok"}')).toMatchObject(
      { success: true, summary: "done", finalAnswer: "ok" },
    );
    expect(
      parseCursorResult('text\nEVAL_RESULT: {"success":true,"summary":"marked"}'),
    ).toMatchObject({ success: true, summary: "marked" });
    expect(parseCursorResult('```json\n{"success":true,"summary":"fenced"}\n```')).toMatchObject({
      success: true,
      summary: "fenced",
    });
  });

  it("runs the CLI stream and reports Cursor metrics", async () => {
    const result = await runCursorAgent({
      plan,
      model: "cursor/auto" as AvailableModel,
      logger: new EvalLogger(false),
      runProcess: scriptedRunner([
        {
          type: "tool_call",
          subtype: "completed",
          call_id: "1",
          tool_call: { readToolCall: { args: {}, result: { success: "one" } } },
        },
        {
          type: "tool_call",
          subtype: "completed",
          call_id: "2",
          tool_call: { readToolCall: { args: {}, result: { success: "two" } } },
        },
        {
          type: "result",
          subtype: "success",
          is_error: false,
          duration_ms: 1234,
          result: '{"success":true,"summary":"done","finalAnswer":"ok"}',
        },
      ]),
    });
    const metrics = result.metrics as Record<string, { value: number; count: number }>;
    expect(result._success).toBe(true);
    expect(result.harnessStatus).toBe("completed");
    expect(result.cursorStatus).toBe("completed");
    expect(result.finalAnswer).toBe("ok");
    expect(metrics.cursor_tool_steps.value).toBe(2);
    expect(metrics.cursor_duration_ms.value).toBe(1234);
    expect(metrics.cursor_input_tokens).toEqual({ count: 1, value: 0 });
    expect(metrics.cursor_output_tokens).toEqual({ count: 1, value: 0 });
    expect(metrics.cursor_total_tokens).toEqual({ count: 1, value: 0 });
    expect(metrics.harness_input_tokens).toEqual({ count: 1, value: 0 });
    expect(metrics.harness_output_tokens).toEqual({ count: 1, value: 0 });
    expect(metrics.harness_total_tokens).toEqual({ count: 1, value: 0 });
    expect(metrics.harness_cost_usd).toBeUndefined();
  });

  it("returns a failed task result for a non-zero exit without a result", async () => {
    const result = await runCursorAgent({
      plan,
      model: "cursor/auto" as AvailableModel,
      logger: new EvalLogger(false),
      runProcess: scriptedRunner([], 1),
    });
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.cursorStatus).toBe("sdk_error");
    expect(String(result.error)).toContain("exited with code 1");
  });
});

function scriptedRunner(events: Array<Record<string, unknown>>, exitCode = 0): CursorProcessRunner {
  return async (input) => {
    for (const event of events) await input.onStdoutLine(JSON.stringify(event));
    return { exitCode, signal: null };
  };
}
