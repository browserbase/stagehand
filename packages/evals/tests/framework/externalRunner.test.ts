import { describe, expect, it } from "vitest";
import { EvalLogger } from "../../logger.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import {
  buildExternalHarnessPrompt,
  buildNormalizedHarnessMetrics,
  legacyHarnessFieldPrefix,
  parseEvalResult,
  runExternalHarnessTask,
} from "../../framework/harnesses/externalRunner.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

describe("external harness runner", () => {
  it("parses the last result marker", () => {
    expect(
      parseEvalResult(
        'EVAL_RESULT: {"success":false}\nEVAL_RESULT: {"success":true,"summary":"last"}',
      ),
    ).toMatchObject({ success: true, summary: "last" });
  });

  it("parses a marker result from its first line", () => {
    expect(
      parseEvalResult('EVAL_RESULT: {"success":true,"summary":"done"}\ntrailing text'),
    ).toMatchObject({ success: true, summary: "done" });
  });

  it("parses the first balanced object after a marker", () => {
    expect(
      parseEvalResult(
        '**EVAL_RESULT: {"success":true,"summary":"found {it}","finalAnswer":"done"}**',
      ),
    ).toMatchObject({ success: true, summary: "found {it}", finalAnswer: "done" });
  });

  it("parses direct no-marker JSON", () => {
    expect(parseEvalResult('{"success":true,"summary":"done"}')).toMatchObject({
      success: true,
      summary: "done",
    });
  });

  it("parses no-marker JSON from the first line", () => {
    expect(parseEvalResult('{"success":true,"summary":"done"}\ntranscript')).toMatchObject({
      success: true,
      summary: "done",
    });
  });

  it("falls back to failure for malformed reports", () => {
    expect(parseEvalResult("not json")).toEqual({ success: false, raw: "not json" });
  });

  it("builds each result-contract tail", () => {
    const marker = buildExternalHarnessPrompt({ plan, resultContract: "marker" });
    const structured = buildExternalHarnessPrompt({
      plan,
      toolInstructions: "Use browse.",
      resultContract: "structured_output",
    });

    expect(marker).toContain(
      "At the end, print exactly one line beginning with EVAL_RESULT: followed by compact JSON.\n" +
        'The JSON schema is: {"success": boolean, "summary": string, "finalAnswer": string}.',
    );
    expect(structured).toContain(
      "Do not edit repository files.\nAt the end, return compact JSON matching this schema:\n" +
        '{"success": boolean, "summary": string, "finalAnswer": string}',
    );
  });

  it("derives deprecated alias prefixes", () => {
    expect(legacyHarnessFieldPrefix("claude_code")).toBe("claudeCode");
    expect(legacyHarnessFieldPrefix("codex")).toBe("codex");
  });

  it("adds normalized metrics only for reported optional values", () => {
    const metrics = buildNormalizedHarnessMetrics({
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      metrics: { native_turns: { count: 1, value: 2 } },
    });
    const complete = buildNormalizedHarnessMetrics({
      usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 3, totalTokens: 18 },
      costUsd: 0.25,
      metrics: {},
    });

    expect(metrics.harness_total_tokens.value).toBe(15);
    expect(metrics.harness_cost_usd).toBeUndefined();
    expect(metrics.harness_cached_input_tokens).toBeUndefined();
    expect(complete.harness_cached_input_tokens.value).toBe(3);
    expect(complete.harness_cost_usd.value).toBe(0.25);
  });

  it("assembles normalized and deprecated task-result fields", async () => {
    const result = await runExternalHarnessTask({
      harness: "claude_code",
      plan,
      logger: new EvalLogger(false),
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: { events: [] },
        resultText: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}',
        transcriptText: "transcript",
        status: "completed",
        stopReason: "finished",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        costUsd: 0.1,
        metrics: { claude_code_turns: { count: 1, value: 2 } },
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;

    expect(result._success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.harnessStatus).toBe("completed");
    expect(result.harnessStopReason).toBe("finished");
    expect(result.claudeCodeStatus).toBe("completed");
    expect(result.claudeCodeStopReason).toBe("finished");
    expect(metrics.claude_code_turns.value).toBe(2);
    expect(metrics.harness_input_tokens.value).toBe(10);
    expect(metrics.harness_total_tokens.value).toBe(15);
  });

  it("bounds hanging evidence capture before verifier fallback", async () => {
    const previous = process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS;
    process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS = "50";
    try {
      const result = await runExternalHarnessTask({
        harness: "codex",
        plan,
        logger: new EvalLogger(false),
        toolAdapter: { captureEvidence: () => new Promise(() => {}) },
        verifier: {
          v3: {} as never,
          taskSpec: {
            id: "wv-1",
            instruction: plan.instruction,
            precomputedRubric: {} as never,
          },
          dataset: "webvoyager",
        },
        resultContract: "structured_output",
        fallbackErrorMessage: "missing result",
        runSession: async () => ({
          raw: { events: [] },
          resultText: '{"success":true,"summary":"done","finalAnswer":"ok"}',
          transcriptText: "",
          status: "completed",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          metrics: {},
        }),
        toTrajectory: () => ({}) as never,
      });

      expect(result._success).toBe(true);
      expect(result.verifierError).toBeDefined();
    } finally {
      if (previous === undefined) delete process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS;
      else process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS = previous;
    }
  });
});
