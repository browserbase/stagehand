import { describe, expect, it } from "vitest";
import { EvalLogger } from "../../logger.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import { runExternalHarnessTask } from "../../framework/harnesses/externalRunner.js";

describe("shared evaluation policy", () => {
  it.each(["native", "task_prefix"] as const)("dispatches policy once via %s", async (mode) => {
    let request = "";
    const result = await runExternalHarnessTask({
      harness: "example",
      implementation: { name: "sdk", version: 1, sdkVersion: "1.0.0" },
      plan: {
        dataset: "webvoyager",
        taskId: "fixture",
        instruction: "Return the exact page title.",
        startUrl: "https://example.test",
      },
      logger: new EvalLogger(false),
      resultContract: "marker",
      fallbackErrorMessage: "missing result",
      systemPromptMode: mode,
      runSession: async (prompt, systemPrompt) => {
        request = `${systemPrompt}\n${prompt}`;
        expect(systemPrompt).toBe(mode === "native" ? EVAL_SYSTEM_PROMPT : "");
        return {
          raw: {},
          resultText: '{"success":true,"finalAnswer":"Example"}',
          transcriptText: "",
          status: "completed",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          metrics: {},
        };
      },
      toTrajectory: () => {
        throw new Error("verifier not configured");
      },
    });
    expect(request.split(EVAL_SYSTEM_PROMPT)).toHaveLength(2);
    expect(request).toContain("Return the exact page title.");
    expect(result.harnessImplementation).toEqual({ name: "sdk", version: 1, sdkVersion: "1.0.0" });
  });
});
