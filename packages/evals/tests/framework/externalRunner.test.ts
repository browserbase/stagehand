import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EvalLogger } from "../../logger.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import {
  buildExternalHarnessPrompt,
  buildFacadeToolCallMetrics,
  buildNormalizedHarnessMetrics,
  buildTimingMetrics,
  buildUsageCostMetrics,
  deriveTerminationReason,
  legacyHarnessFieldPrefix,
  parseEvalResult,
  resolveFinalAnswer,
  runExternalHarnessTask,
  stripEmbeddedEvalReports,
} from "../../framework/harnesses/externalRunner.js";
import { buildTrajectory } from "../../framework/harnesses/trajectoryAdapter.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";

const verifierState = vi.hoisted(() => ({
  result: undefined as Record<string, unknown> | undefined,
}));

vi.mock("stagehand-v3", async (importOriginal) => {
  const mod = await importOriginal<typeof import("stagehand-v3")>();
  class FakeV3Evaluator {
    async verify() {
      if (verifierState.result) return verifierState.result;
      throw new Error("fake verifier unavailable");
    }
  }
  return {
    ...mod,
    V3Evaluator: FakeV3Evaluator as unknown as typeof mod.V3Evaluator,
  };
});

let previousPersist: string | undefined;

beforeAll(() => {
  previousPersist = process.env.VERIFIER_PERSIST_TRAJECTORIES;
  process.env.VERIFIER_PERSIST_TRAJECTORIES = "0";
});

afterAll(() => {
  if (previousPersist === undefined) delete process.env.VERIFIER_PERSIST_TRAJECTORIES;
  else process.env.VERIFIER_PERSIST_TRAJECTORIES = previousPersist;
});

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

describe("external harness runner", () => {
  it.each([true, false])(
    "keeps execution loss separate from verified completion=%s",
    async (outcomeSuccess) => {
      verifierState.result = {
        outcomeSuccess,
        processScore: outcomeSuccess ? 1 : 0,
        perCriterion: [{ criterion: "title", maxPoints: 1, earnedPoints: outcomeSuccess ? 1 : 0 }],
      };
      try {
        const result = await runExternalHarnessTask({
          harness: "example",
          plan,
          logger: new EvalLogger(false),
          resultContract: "marker",
          fallbackErrorMessage: "incomplete",
          implementation: { name: "sdk", version: 1 },
          toolAdapter: {
            browserSessionLoss: () => ({
              cause: "CDP connection closed",
              timestamp: new Date().toISOString(),
            }),
            observedToolMatcher: (name) => name === "stagehand.run",
          },
          verifier: {
            v3: {} as never,
            dataset: "test",
            taskSpec: {
              id: "fixture",
              instruction: "Read title",
              precomputedRubric: {
                items: [
                  { criterion: "title", description: "Read the correct title", maxPoints: 1 },
                ],
              },
            },
          },
          runSession: async () => ({
            raw: {},
            resultText: '{"success":true,"finalAnswer":"Example"}',
            transcriptText: "",
            status: "completed",
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            metrics: {},
          }),
          toTrajectory: ({ status }, taskSpec) =>
            buildTrajectory({
              taskSpec,
              status,
              finalAnswer: "Example",
              toolCalls: [
                {
                  name: "stagehand.run",
                  args: { code: "return page.title()" },
                  result: "Example",
                  ok: true,
                },
              ],
            }),
        });
        expect(result.verifierError).toBeUndefined();
        expect(result._success).toBe(outcomeSuccess);
        expect(result.harnessStatus).toBe("sdk_error");
        expect(result.terminationReason).toBe("browser_session_lost");
        expect(result.harnessImplementation).toEqual({ name: "sdk", version: 1 });
      } finally {
        verifierState.result = undefined;
      }
    },
  );

  it.each([
    ["marker", "native"],
    ["structured_output", "native"],
    ["marker", "task_prefix"],
    ["structured_output", "task_prefix"],
  ] as const)("dispatches %s with eval policy via %s", async (resultContract, systemPromptMode) => {
    const instruction = "Find the item and stop before the final purchase.";
    let dispatchedPrompt = "";
    let dispatchedSystemPrompt = "";
    await runExternalHarnessTask({
      harness: "test",
      plan: { ...plan, instruction },
      logger: new EvalLogger(false),
      resultContract,
      systemPromptMode,
      toolAdapter: { promptInstructions: "Use the mounted browser." },
      fallbackErrorMessage: "missing result",
      runSession: async (prompt, systemPrompt) => {
        dispatchedPrompt = prompt;
        dispatchedSystemPrompt = systemPrompt;
        return {
          raw: {},
          resultText: '{"success":true}',
          transcriptText: "",
          status: "completed",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          metrics: {},
        };
      },
      toTrajectory: () => {
        throw new Error("no verifier configured");
      },
    });
    expect(dispatchedSystemPrompt).toBe(systemPromptMode === "native" ? EVAL_SYSTEM_PROMPT : "");
    expect(dispatchedPrompt.split(EVAL_SYSTEM_PROMPT)).toHaveLength(
      systemPromptMode === "native" ? 1 : 2,
    );
    expect(dispatchedPrompt).toContain(`Instruction:\n${instruction}`);
    expect(dispatchedPrompt).toContain(plan.startUrl);
    expect(dispatchedPrompt).toContain("Use the mounted browser.");
    expect(dispatchedPrompt.match(/At the end,/g)).toHaveLength(1);
  });

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

  it("lets structured-output harnesses parse the first balanced object after a marker", () => {
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

  it("lets marker harnesses parse first-line no-marker JSON", () => {
    expect(parseEvalResult('{"success":true,"summary":"done"}\ntranscript')).toMatchObject({
      success: true,
      summary: "done",
    });
  });

  it("falls back to failure for malformed reports", () => {
    expect(parseEvalResult("not json")).toEqual({ success: false, raw: "not json" });
  });

  it("parses the last report-shaped object trailing free-form narration", () => {
    const raw = [
      "I’ll open Imgur, inspect the meme, and report back.",
      'The tool returned {"url":"https://imgur.com"} so I continued.',
      '{"success":true,"summary":"Inspected the meme.","finalAnswer":"A cat on a keyboard."}',
    ].join("\n\n");
    expect(parseEvalResult(raw)).toMatchObject({
      success: true,
      summary: "Inspected the meme.",
      finalAnswer: "A cat on a keyboard.",
    });
    // A report quoted mid-prose, with more prose after it, is not the conclusion.
    expect(parseEvalResult(`${raw}\nthen I kept going`).success).toBe(false);
  });

  it("resolves the final answer from the report, else from the last message minus eval report envelopes", () => {
    expect(resolveFinalAnswer({ finalAnswer: "42" }, "ignored")).toBe("42");
    expect(
      resolveFinalAnswer({}, 'The answer is on the page.\n\n{"success":true,"summary":"reported"}'),
    ).toBe("The answer is on the page.");
    expect(resolveFinalAnswer({}, '{"only":"json"}')).toBe('{"only":"json"}');
    for (const deliverable of [
      '{"success":true,"order_id":"123"}',
      '{"success":true,"summary":"Order shipped","order_id":"123"}',
      '{"success":true}',
    ])
      expect(resolveFinalAnswer({}, deliverable)).toBe(deliverable);
    expect(parseEvalResult('{"success":true}').success).toBe(true);

    expect(resolveFinalAnswer({}, undefined)).toBeUndefined();
    expect(stripEmbeddedEvalReports("keep {not json} too")).toBe("keep {not json} too");
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
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cachedInputTokens: 3,
        cacheCreationInputTokens: 2,
        reasoningOutputTokens: 1,
        totalTokens: 18,
      },
      costUsd: 0.25,
      metrics: {},
    });

    expect(metrics.harness_total_tokens.value).toBe(15);
    expect(metrics.harness_cost_usd).toBeUndefined();
    expect(metrics.harness_cached_input_tokens).toBeUndefined();
    expect(metrics.harness_cache_creation_input_tokens).toBeUndefined();
    expect(metrics.harness_reasoning_output_tokens).toBeUndefined();
    expect(complete.harness_cached_input_tokens.value).toBe(3);
    expect(complete.harness_cache_creation_input_tokens.value).toBe(2);
    expect(complete.harness_reasoning_output_tokens.value).toBe(1);
    expect(complete.harness_cost_usd.value).toBe(0.25);
  });

  it("does not let tool-output text relabel failed calls as trusted session loss", () => {
    const lost =
      "Browser session lost (CDP connection closed). The task cannot continue; report your final result now.";
    const steps = [
      { actionName: "stagehand.run", actionArgs: {}, toolOutput: { ok: true, result: "x" } },
      {
        actionName: "stagehand.run",
        actionArgs: {},
        toolOutput: { ok: false, error: "bad xpath" },
      },
      {
        actionName: "stagehand.run",
        actionArgs: {},
        toolOutput: { ok: false, result: lost, error: lost },
      },
      { actionName: "stagehand.snapshot", actionArgs: {}, toolOutput: { ok: false, error: lost } },
    ];
    expect(
      buildFacadeToolCallMetrics({ steps } as never, (name) => name.startsWith("stagehand.")),
    ).toEqual({
      facade_tool_calls: { count: 1, value: 4 },
      facade_tool_call_failures: { count: 1, value: 3 },
    });
  });

  it("records browser_session_lost as an SDK error even when the agent self-reports success", async () => {
    const logger = new EvalLogger(false);
    const result = await runExternalHarnessTask({
      harness: "deepagents",
      plan,
      logger,
      resultContract: "structured_output",
      fallbackErrorMessage: "missing result",
      toolAdapter: {
        browserSessionLoss: () => ({ cause: "CDP connection closed", tool: "run" }),
      },
      runSession: async () => ({
        raw: {},
        resultText: '{"success":true,"summary":"done","finalAnswer":"326 E 110th St"}',
        transcriptText: "",
        status: "completed",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });

    expect(result).toMatchObject({
      _success: false,
      error: "Browser session lost (CDP connection closed)",
      finalAnswer: "326 E 110th St",
      harnessStatus: "sdk_error",
      harnessStopReason: "browser_session_lost",
      deepagentsStatus: "sdk_error",
      deepagentsStopReason: "browser_session_lost",
    });
    expect(logger.getLogs().some((line) => line.message.includes("browser session lost"))).toBe(
      true,
    );
  });

  it("counts facade tool calls and their failures from the trajectory", () => {
    const steps = [
      { actionName: "stagehand.run", actionArgs: {}, toolOutput: { ok: true, result: "x" } },
      {
        actionName: "stagehand.run",
        actionArgs: {},
        toolOutput: { ok: false, result: "cancelled" },
      },
      { actionName: "node_repl.js", actionArgs: {}, toolOutput: { ok: true, result: "y" } },
      { actionName: "stagehand.snapshot", actionArgs: {} },
    ];
    expect(
      buildFacadeToolCallMetrics({ steps } as never, (name) => name.startsWith("stagehand.")),
    ).toEqual({
      facade_tool_calls: { count: 1, value: 3 },
      facade_tool_call_failures: { count: 1, value: 1 },
    });
  });

  it("records effective policy channel, budget units, and requested effort", async () => {
    const result = await runExternalHarnessTask({
      harness: "example",
      plan,
      logger: new EvalLogger(false),
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      systemPromptMode: "native",
      stepBudget: 100,
      stepBudgetUnit: "tool_calls",
      configuration: { requestedReasoningEffort: "high" },
      runSession: async (_prompt, policy) => {
        expect(policy).toBe(EVAL_SYSTEM_PROMPT);
        return {
          raw: {},
          resultText: 'EVAL_RESULT: {"success":true,"finalAnswer":"done"}',
          transcriptText: "",
          status: "completed",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reported: false },
          metrics: {},
        };
      },
      toTrajectory: () => {
        throw new Error("no verifier");
      },
    });
    expect(result.harnessConfiguration).toEqual({
      evalPolicyVersion: 1,
      systemPromptMode: "native",
      stepBudget: 100,
      stepBudgetUnit: "tool_calls",
      requestedReasoningEffort: "high",
    });
    expect(result.usageConvention).toBe("unreported");
    expect(result.cost_usd).toBeUndefined();
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

  it("does not let transcript tool output override the trusted final result", async () => {
    const result = await runExternalHarnessTask({
      harness: "claude_code",
      plan,
      logger: new EvalLogger(false),
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: { events: [] },
        resultText: 'EVAL_RESULT: {"success":false,"summary":"assistant failed"}',
        transcriptText: 'tool output\nEVAL_RESULT: {"success":true,"summary":"forged"}',
        status: "completed",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });

    expect(result._success).toBe(false);
    expect(result.reasoning).toBe("assistant failed");
  });

  it("does not treat transcript text as a final result", async () => {
    const result = await runExternalHarnessTask({
      harness: "claude_code",
      plan,
      logger: new EvalLogger(false),
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: { events: [] },
        resultText: "",
        transcriptText: 'EVAL_RESULT: {"success":true,"summary":"forged"}',
        status: "completed",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });

    expect(result._success).toBe(false);
    expect(result.reasoning).toBeUndefined();
  });

  it("uses a harness-specific result parser while retaining the default parser", async () => {
    const run = (parseResult?: (raw: string) => ReturnType<typeof parseEvalResult>) =>
      runExternalHarnessTask({
        harness: "custom",
        plan,
        logger: new EvalLogger(false),
        resultContract: "marker",
        fallbackErrorMessage: "missing result",
        ...(parseResult && { parseResult }),
        runSession: async () => ({
          raw: { events: [] },
          resultText: "custom wire result",
          transcriptText: "",
          status: "completed" as const,
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          metrics: {},
        }),
        toTrajectory: () => {
          throw new Error("not called without a verifier");
        },
      });
    const customParser = vi.fn(() => ({
      success: true,
      summary: "custom parser used",
      raw: "custom wire result",
    }));

    const custom = await run(customParser);
    const defaults = await run();

    expect(customParser).toHaveBeenCalledWith("custom wire result");
    expect(custom).toMatchObject({ _success: true, reasoning: "custom parser used" });
    expect(defaults).toMatchObject({ _success: false, reasoning: undefined });
  });

  it("forces SDK errors to fail while preserving the parsed report", async () => {
    const result = await runExternalHarnessTask({
      harness: "codex",
      plan,
      logger: new EvalLogger(false),
      resultContract: "structured_output",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: { events: [] },
        resultText: '{"success":true,"summary":"done","finalAnswer":"answer"}',
        transcriptText: "",
        iterationError: new Error("iteration failed"),
        status: "sdk_error",
        stopReason: "https://x.test?apiKey=secret123",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });

    expect(result).toMatchObject({
      _success: false,
      error: "https://x.test?apiKey=[redacted]",
      reasoning: "done",
      finalAnswer: "answer",
      harnessStopReason: "https://x.test?apiKey=[redacted]",
      codexStopReason: "https://x.test?apiKey=[redacted]",
    });
    expect(JSON.stringify(result)).not.toContain("secret123");
  });

  it("preserves a max-turns self-report and records its stop reason", async () => {
    const result = await runExternalHarnessTask({
      harness: "claude_code",
      plan,
      logger: new EvalLogger(false),
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: { events: [] },
        resultText: 'EVAL_RESULT: {"success":true,"summary":"budget result"}',
        transcriptText: "",
        status: "max_turns",
        stopReason: "maximum turn budget reached",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });

    expect(result._success).toBe(true);
    expect(result.harnessStopReason).toBe("maximum turn budget reached");
    expect(result.terminationReason).toBe("step_budget");
  });

  it("derives why a run ended from its status and stop reason", () => {
    expect(deriveTerminationReason({ status: "completed" })).toBe("completed");
    expect(
      deriveTerminationReason({
        status: "max_turns",
        stopReason: "tool step budget exhausted (75 steps)",
      }),
    ).toBe("step_budget");
    expect(
      deriveTerminationReason({ status: "sdk_error", stopReason: "browser_session_lost" }),
    ).toBe("browser_session_lost");
    expect(deriveTerminationReason({ status: "sdk_error", stopReason: "aborted" })).toBe("aborted");
    expect(
      deriveTerminationReason({
        status: "sdk_error",
        stopReason: "This operation was aborted",
      }),
    ).toBe("aborted");
    expect(deriveTerminationReason({ status: "sdk_error", stopReason: "interrupted" })).toBe(
      "aborted",
    );
    expect(deriveTerminationReason({ status: "sdk_error", stopReason: "ECONNRESET" })).toBe(
      "sdk_error",
    );
    expect(deriveTerminationReason({ status: "sdk_error" })).toBe("sdk_error");
  });

  it("bounds hanging evidence capture before verifier fallback", async () => {
    const previous = process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS;
    process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS = "50";
    let captureInvocations = 0;
    let drainInvocations = 0;
    try {
      const result = await runExternalHarnessTask({
        harness: "codex",
        plan,
        logger: new EvalLogger(false),
        toolAdapter: {
          captureEvidence: () => {
            captureInvocations += 1;
            return new Promise(() => {});
          },
          drainStepObservations: () => {
            drainInvocations += 1;
            return new Promise(() => {});
          },
        },
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

      expect(result._success).toBe(false);
      expect(result.agentReportedSuccess).toBe(true);
      expect(result.verifierError).toBeDefined();
      expect(captureInvocations).toBe(1);
      expect(drainInvocations).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS;
      else process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS = previous;
    }
  });

  it("ships the normalized step trace in the row logs once the trajectory exists", async () => {
    const logger = new EvalLogger(false);
    logger.log({ category: "codex", message: "tool-call-delta event", level: 2 });
    const result = await runExternalHarnessTask({
      harness: "codex",
      plan,
      logger,
      toolAdapter: { observedToolMatcher: (name) => name.startsWith("stagehand.") },
      verifier: {
        v3: {} as never,
        taskSpec: { id: "wv-1", instruction: plan.instruction, precomputedRubric: {} as never },
        dataset: "webvoyager",
      },
      resultContract: "structured_output",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: {},
        resultText: '{"success":true,"summary":"done","finalAnswer":"ok"}',
        transcriptText: "",
        status: "completed",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: {},
      }),
      toTrajectory: (_input, taskSpec) =>
        buildTrajectory({
          taskSpec,
          toolCalls: [
            {
              name: "stagehand.run",
              args: { code: "return page.title()" },
              result: "Example",
              ok: true,
              reasoning: "read the title",
            },
            { name: "bash", args: { command: "echo hi" }, result: "hi", ok: true },
          ],
        }),
    });

    const messages = (result.logs ?? []).map((line) => line.message);
    expect(messages).toEqual([
      expect.stringContaining("cost unavailable for codex on (unknown model)"),
      "step 1 · think · read the title",
      "step 1 · run · ok · return page.title()  →  Example",
      "step 2 · bash · ok · echo hi  →  hi",
      "summary · done",
      "answer · ok",
      expect.stringMatching(
        /^result · completed · steps=2 · facade_calls=1 · in=10 \(cached 0\) out=5 · agent=\d+\.\ds$/u,
      ),
      expect.stringContaining("verifier integration failed"),
      expect.stringMatching(
        /^timing · agent=\d+\.\ds · evidence=\d+\.\ds · verifier=\d+\.\ds · total=\d+\.\ds$/u,
      ),
    ]);
    expect(result.metrics).toMatchObject({ facade_tool_calls: { count: 1, value: 1 } });
  });

  it.each([
    ["never resolves", () => new Promise<never>(() => {})],
    ["rejects", () => Promise.reject(new Error("drain failed"))],
  ])("treats drainStepObservations that %s as bounded best-effort evidence", async (_, drain) => {
    const previous = process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS;
    process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS = "25";
    const finalObservation = { url: "https://example.com" } as never;
    let trajectoryInput: Record<string, unknown> | undefined;
    let captureInvocations = 0;
    let drainInvocations = 0;
    try {
      const result = await runExternalHarnessTask({
        harness: "codex",
        plan,
        logger: new EvalLogger(false),
        toolAdapter: {
          captureEvidence: async () => {
            captureInvocations += 1;
            return finalObservation;
          },
          drainStepObservations: () => {
            drainInvocations += 1;
            return drain();
          },
        },
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
        toTrajectory: (input) => {
          trajectoryInput = input as unknown as Record<string, unknown>;
          return {} as never;
        },
      });

      expect(result._success).toBe(false);
      expect(result.verifierError).toBeDefined();
      expect(trajectoryInput?.finalObservation).toBe(finalObservation);
      expect(trajectoryInput?.stepObservations).toBeUndefined();
      expect(captureInvocations).toBe(1);
      expect(drainInvocations).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS;
      else process.env.EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS = previous;
    }
  });

  it("splits agent, evidence and verifier wall-clock into separate metrics", async () => {
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const result = await runExternalHarnessTask({
      harness: "codex",
      plan,
      logger: new EvalLogger(false),
      toolAdapter: {
        captureEvidence: async () => {
          await delay(30);
          return { url: "https://example.com" } as never;
        },
      },
      verifier: {
        v3: {} as never,
        taskSpec: { id: "wv-1", instruction: plan.instruction, precomputedRubric: {} as never },
        dataset: "webvoyager",
      },
      resultContract: "structured_output",
      fallbackErrorMessage: "missing result",
      runSession: async () => {
        await delay(50);
        return {
          raw: {},
          resultText: '{"success":true,"summary":"done","finalAnswer":"ok"}',
          transcriptText: "",
          status: "completed",
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          metrics: {},
        };
      },
      toTrajectory: (_input, taskSpec) => buildTrajectory({ taskSpec, toolCalls: [] }),
    });
    const metrics = result.metrics as Record<string, { value: number }>;

    expect(metrics.agent_wall_ms.value).toBeGreaterThanOrEqual(45);
    expect(metrics.evidence_ms.value).toBeGreaterThanOrEqual(25);
    expect(metrics.verifier_wall_ms.value).toBeGreaterThanOrEqual(0);
    expect(metrics.total_wall_ms.value).toBeCloseTo(
      metrics.agent_wall_ms.value + metrics.evidence_ms.value + metrics.verifier_wall_ms.value,
      3,
    );
    expect(result.agent_wall_ms).toBe(Math.round(metrics.agent_wall_ms.value));
  });

  it("reports total_wall_ms as the agent time alone when no verifier runs", async () => {
    const result = await runExternalHarnessTask({
      harness: "codex",
      plan,
      logger: new EvalLogger(false),
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: {},
        resultText: 'EVAL_RESULT: {"success":true}',
        transcriptText: "",
        status: "completed",
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(metrics.total_wall_ms.value).toBe(metrics.agent_wall_ms.value);
    expect(metrics.verifier_wall_ms).toBeUndefined();
  });

  it("sums the timing split into total_wall_ms", () => {
    expect(buildTimingMetrics({ agentWallMs: 1000, evidenceMs: 200, verifierWallMs: 300 })).toEqual(
      {
        agent_wall_ms: { count: 1, value: 1000 },
        evidence_ms: { count: 1, value: 200 },
        verifier_wall_ms: { count: 1, value: 300 },
        total_wall_ms: { count: 1, value: 1500 },
      },
    );
  });

  it("emits normalized usage and the harness-reported bill next to the harness-native metrics", async () => {
    const logger = new EvalLogger(false);
    const result = await runExternalHarnessTask({
      harness: "claude_code",
      plan,
      model: "anthropic/claude-sonnet-4-6",
      logger,
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: {},
        resultText: 'EVAL_RESULT: {"success":true}',
        transcriptText: "",
        status: "completed",
        usage: {
          inputTokens: 1_000_000,
          cachedInputTokens: 2_000_000,
          cacheCreationInputTokens: 0,
          outputTokens: 100_000,
          totalTokens: 3_100_000,
        },
        costUsd: 4.2,
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;

    // Anthropic convention: cache reads sit outside input_tokens.
    expect(metrics.usage_input_total.value).toBe(3_000_000);
    expect(metrics.usage_input_cached.value).toBe(2_000_000);
    expect(metrics.usage_output.value).toBe(100_000);
    expect(metrics.usage_reasoning.value).toBe(0);
    // Legacy metrics stay untouched for existing dashboards.
    expect(metrics.harness_input_tokens.value).toBe(1_000_000);
    expect(metrics.harness_cost_usd.value).toBe(4.2);
    // The reported bill is the cost column.
    expect(metrics.cost_usd.value).toBe(4.2);
    expect(result).toMatchObject({
      cost_source: "reported",
      billing_channel: "anthropic_api",
      cost_usd: 4.2,
    });
    expect(logger.getLogs().some((line) => line.category === "cost")).toBe(false);
  });

  it("computes a direct-API harness's bill at provider list price when nothing was reported", async () => {
    const logger = new EvalLogger(false);
    const result = await runExternalHarnessTask({
      harness: "codex",
      plan,
      model: "openai/gpt-5.4-mini",
      logger,
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: {},
        resultText: 'EVAL_RESULT: {"success":true}',
        transcriptText: "",
        status: "completed",
        usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;

    // gpt-5.4-mini list price $0.75/M uncached input.
    expect(metrics.cost_usd.value).toBeCloseTo(0.75, 6);
    expect(result).toMatchObject({
      cost_source: "computed",
      billing_channel: "openai_api",
      cost_pricing: {
        as_of: expect.any(String),
        model: expect.any(String),
        source: expect.any(String),
      },
    });
    expect(logger.getLogs().some((line) => line.category === "cost")).toBe(false);
  });

  it("leaves cost absent and names the model and channel when the bill is unavailable", async () => {
    const logger = new EvalLogger(false);
    const result = await runExternalHarnessTask({
      harness: "codex",
      plan,
      model: "openai/gpt-unpriced-fixture",
      logger,
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: {},
        resultText: 'EVAL_RESULT: {"success":true}',
        transcriptText: "",
        status: "completed",
        usage: { inputTokens: 100, cachedInputTokens: 40, outputTokens: 5, totalTokens: 105 },
        metrics: {},
      }),
      toTrajectory: () => {
        throw new Error("not called without a verifier");
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;

    expect(metrics.usage_input_total.value).toBe(100);
    expect(metrics.usage_input_cached.value).toBe(40);
    expect(metrics.cost_usd).toBeUndefined();
    expect(result.cost_source).toBe("unavailable");
    expect(result.billing_channel).toBe("openai_api");
    expect(result.cost_usd).toBeUndefined();
    const costLine = logger.getLogs().find((line) => line.category === "cost");
    expect(costLine?.level).toBe(1);
    expect(costLine?.message).toContain("openai/gpt-unpriced-fixture");
    expect(costLine?.message).toContain("openai_api");
  });

  it("shows the billed cost and its source on the timing line", async () => {
    const logger = new EvalLogger(false);
    const result = await runExternalHarnessTask({
      harness: "codex",
      plan,
      model: "openai/gpt-5.4-mini",
      logger,
      verifier: {
        v3: {} as never,
        taskSpec: { id: "wv-1", instruction: plan.instruction, precomputedRubric: {} as never },
        dataset: "webvoyager",
      },
      resultContract: "structured_output",
      fallbackErrorMessage: "missing result",
      runSession: async () => ({
        raw: {},
        resultText: '{"success":true,"summary":"done","finalAnswer":"ok"}',
        transcriptText: "",
        status: "completed",
        usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
        metrics: {},
      }),
      toTrajectory: (_input, taskSpec) => buildTrajectory({ taskSpec, toolCalls: [] }),
    });
    const timing = result.logs?.find((line) => line.message.startsWith("timing"));
    expect(timing?.message).toContain("cost=$0.75 (computed)");
  });

  it("builds usage/cost metrics without inventing a zero-dollar estimate", () => {
    const usage = {
      input_total: 10,
      input_cached: 4,
      input_cache_write: 0,
      input_uncached: 6,
      output: 2,
      reasoning: 1,
      reasoning_in_output: true,
      convention: "openai_cached_subset" as const,
    };
    expect(
      buildUsageCostMetrics(usage, { cost_source: "unavailable", billing_channel: "openai_api" }),
    ).toEqual({
      usage_input_total: { count: 1, value: 10 },
      usage_input_cached: { count: 1, value: 4 },
      usage_output: { count: 1, value: 2 },
      usage_reasoning: { count: 1, value: 1 },
    });
    expect(
      buildUsageCostMetrics(usage, {
        cost_source: "computed",
        cost_usd: 0.5,
        billing_channel: "openai_api",
      }),
    ).toEqual({
      usage_input_total: { count: 1, value: 10 },
      usage_input_cached: { count: 1, value: 4 },
      usage_output: { count: 1, value: 2 },
      usage_reasoning: { count: 1, value: 1 },
      cost_usd: { count: 1, value: 0.5 },
    });
    // Unreported usage carries no usage_* metrics: zeros would read as a free run.
    expect(
      buildUsageCostMetrics(
        {
          ...usage,
          input_total: 0,
          input_cached: 0,
          input_uncached: 0,
          output: 0,
          reasoning: 0,
          convention: "unreported",
        },
        { cost_source: "unavailable", billing_channel: "subscription" },
      ),
    ).toEqual({});
  });
});

it("keeps task JSON as the final answer and passes it to trajectory conversion", async () => {
  const answer = JSON.stringify({ products: [{ name: "example", price: 19 }] });
  let trajectoryAnswer: string | undefined;
  const result = await runExternalHarnessTask({
    harness: "codex",
    plan,
    logger: new EvalLogger(false),
    verifier: {
      v3: {} as never,
      taskSpec: { id: "json-task", instruction: plan.instruction, precomputedRubric: {} as never },
      dataset: "webvoyager",
    },
    resultContract: "structured_output",
    fallbackErrorMessage: "missing result",
    runSession: async () => ({
      raw: {},
      resultText: answer,
      transcriptText: "",
      status: "completed",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      metrics: {},
    }),
    toTrajectory: ({ parsed }, taskSpec) => {
      trajectoryAnswer = parsed.finalAnswer;
      return buildTrajectory({ taskSpec, toolCalls: [], finalAnswer: parsed.finalAnswer });
    },
  });
  expect(result.finalAnswer).toBe(answer);
  expect(trajectoryAnswer).toBe(answer);
});

it("sanitizes SDK stop reasons before emitting verifier trajectory traces", async () => {
  const logger = new EvalLogger(false);
  await runExternalHarnessTask({
    harness: "codex",
    plan,
    logger,
    verifier: {
      v3: {} as never,
      taskSpec: { id: "trace-task", instruction: plan.instruction, precomputedRubric: {} as never },
      dataset: "webvoyager",
    },
    resultContract: "structured_output",
    fallbackErrorMessage: "missing result",
    runSession: async () => ({
      raw: {},
      resultText: "",
      transcriptText: "",
      status: "sdk_error",
      stopReason: "request failed https://provider.example?apiKey=secret-query-value",
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      metrics: {},
    }),
    toTrajectory: (_input, taskSpec) => buildTrajectory({ taskSpec, toolCalls: [] }),
  });
  expect(logger.getLogs().some((line) => line.category === "trace")).toBe(true);
  expect(JSON.stringify(logger.getLogs())).not.toContain("secret-query-value");
});
