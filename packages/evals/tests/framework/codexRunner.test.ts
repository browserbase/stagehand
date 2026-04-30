import { describe, expect, it } from "vitest";
import type { AvailableModel } from "@browserbasehq/stagehand";
import {
  buildCodexPrompt,
  normalizeCodexModel,
  parseCodexResult,
  runCodexAgent,
  type CodexSdk,
} from "../../framework/codexRunner.js";
import { EvalLogger } from "../../logger.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

describe("codex runner helpers", () => {
  it("normalizes provider-prefixed models for Codex", () => {
    expect(normalizeCodexModel("openai/gpt-5.4-mini" as AvailableModel)).toBe(
      "gpt-5.4-mini",
    );
    expect(normalizeCodexModel("gpt-5.4" as AvailableModel)).toBe("gpt-5.4");
    expect(normalizeCodexModel("codex/default" as AvailableModel)).toBe(
      "gpt-5.4-mini",
    );
  });

  it("builds a browser task prompt with structured result instructions", () => {
    const prompt = buildCodexPrompt(
      plan,
      "Use browse only. Discover usage with browse -h.",
    );

    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find the checkout button");
    expect(prompt).toContain("Use browse only.");
    expect(prompt).toContain("browse -h");
    expect(prompt).toContain('"success": boolean');
  });

  it("parses direct JSON results", () => {
    expect(
      parseCodexResult(
        '{"success":true,"summary":"done","finalAnswer":"clicked"}',
      ),
    ).toEqual({
      success: true,
      summary: "done",
      finalAnswer: "clicked",
      raw: '{"success":true,"summary":"done","finalAnswer":"clicked"}',
    });
  });

  it("parses legacy EVAL_RESULT marker JSON", () => {
    expect(
      parseCodexResult(
        'assistant text\nEVAL_RESULT: {"success":true,"summary":"done"}',
      ),
    ).toMatchObject({
      success: true,
      summary: "done",
    });
  });

  it("streams events into a task result and reports token metrics", async () => {
    let capturedThreadOptions: Record<string, unknown> | undefined;
    let capturedTurnOptions: Record<string, unknown> | undefined;
    const sdk: CodexSdk = {
      startThread: (options) => {
        capturedThreadOptions = options;
        return {
          runStreamed: async (_input, turnOptions) => {
            capturedTurnOptions = turnOptions;
            return {
              events: (async function* () {
                yield {
                  type: "item.completed",
                  item: {
                    id: "msg-1",
                    type: "agent_message",
                    text: '{"success":true,"summary":"done","finalAnswer":"ok"}',
                  },
                };
                yield {
                  type: "turn.completed",
                  usage: {
                    input_tokens: 100,
                    cached_input_tokens: 10,
                    output_tokens: 25,
                    reasoning_output_tokens: 5,
                  },
                };
              })(),
            };
          },
        };
      },
    };

    const result = await runCodexAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
      toolAdapter: {
        toolSurface: "browse_cli",
        startupProfile: "tool_launch_local",
        cwd: "/tmp/stagehand-evals-test",
        env: { PATH: "/tmp" },
        promptInstructions: "Use browse.",
        metadata: {
          toolCommand: "browse",
          browseCliEntrypoint: "/tmp/browse",
        },
        cleanup: async () => {},
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;

    expect(result._success).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.codexStatus).toBe("completed");
    expect(result.finalAnswer).toBe("ok");
    expect(capturedThreadOptions).toMatchObject({
      model: "gpt-5.4-mini",
      workingDirectory: "/tmp/stagehand-evals-test",
      skipGitRepoCheck: true,
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      networkAccessEnabled: true,
    });
    expect(capturedTurnOptions?.outputSchema).toMatchObject({
      type: "object",
    });
    expect(metrics.codex_input_tokens.value).toBe(100);
    expect(metrics.codex_cached_input_tokens.value).toBe(10);
    expect(metrics.codex_output_tokens.value).toBe(25);
    expect(metrics.codex_reasoning_output_tokens.value).toBe(5);
    expect(metrics.codex_total_tokens.value).toBe(140);
  });

  it("returns a failed task result instead of throwing on SDK errors", async () => {
    const sdk: CodexSdk = {
      startThread: () => ({
        runStreamed: async () => {
          throw new Error("codex failed");
        },
      }),
    };

    const result = await runCodexAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });

    expect(result._success).toBe(false);
    expect(result.codexStatus).toBe("sdk_error");
    expect(String(result.error)).toContain("codex failed");
  });
});
