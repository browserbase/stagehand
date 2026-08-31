import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import {
  buildCodexPrompt,
  parseCodexResult,
  runCodexAgent,
  type CodexSdk,
  buildEvalCodexConfig,
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
  it("requests reasoning summaries unless disabled, letting the tool adapter's config win", () => {
    expect(buildEvalCodexConfig({ mcp_servers: {} }, {})).toEqual({
      model_reasoning_summary: "detailed",
      mcp_servers: {},
    });
    expect(buildEvalCodexConfig(undefined, { EVAL_REASONING_SUMMARY: "auto" })).toEqual({
      model_reasoning_summary: "auto",
    });
    expect(buildEvalCodexConfig({}, { EVAL_REASONING_SUMMARY: "off" })).toEqual({});
    expect(
      buildEvalCodexConfig({ model_reasoning_summary: "concise" }, {}).model_reasoning_summary,
    ).toBe("concise");
  });

  it("builds a browser task prompt with structured result instructions", () => {
    const prompt = buildCodexPrompt(plan, "Use browse only. Discover usage with browse -h.");

    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find the checkout button");
    expect(prompt).toContain("Use browse only.");
    expect(prompt).toContain("browse -h");
    expect(prompt).toContain('"success": boolean');
  });

  it("parses direct JSON results", () => {
    expect(parseCodexResult('{"success":true,"summary":"done","finalAnswer":"clicked"}')).toEqual({
      success: true,
      summary: "done",
      finalAnswer: "clicked",
      raw: '{"success":true,"summary":"done","finalAnswer":"clicked"}',
    });
  });

  it("parses legacy EVAL_RESULT marker JSON", () => {
    expect(
      parseCodexResult('assistant text\nEVAL_RESULT: {"success":true,"summary":"done"}'),
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
        browserSession: { provider: "local" },
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
      sandboxMode: "read-only",
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
    expect(metrics.codex_total_tokens.value).toBe(125);
    expect(metrics.harness_input_tokens.value).toBe(100);
    expect(metrics.harness_cached_input_tokens.value).toBe(10);
    expect(metrics.harness_output_tokens.value).toBe(25);
    expect(metrics.harness_reasoning_output_tokens.value).toBe(5);
    expect(metrics.harness_total_tokens.value).toBe(125);
    expect(metrics.harness_cost_usd).toBeUndefined();
    expect(result.harnessStatus).toBe("completed");
  });

  it("does not double-count cached input or reasoning output token subsets", async () => {
    const sdk: CodexSdk = {
      startThread: () => ({
        runStreamed: async () => ({
          events: (async function* () {
            yield {
              type: "item.completed",
              item: { id: "msg-1", type: "agent_message", text: '{"success":true}' },
            };
            yield {
              type: "turn.completed",
              usage: {
                input_tokens: 10_000,
                cached_input_tokens: 8_000,
                output_tokens: 500,
                reasoning_output_tokens: 300,
              },
            };
          })(),
        }),
      }),
    };

    const result = await runCodexAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });
    const metrics = result.metrics as Record<string, { value: number }>;

    expect(metrics.codex_total_tokens.value).toBe(10_500);
    expect(metrics.harness_total_tokens.value).toBe(10_500);
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
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBeDefined();
    expect(String(result.error)).toContain("codex failed");
  });

  it("redacts SDK iteration errors used as stop reasons", async () => {
    const sdk: CodexSdk = {
      startThread: () => ({
        runStreamed: async () => {
          throw new Error("failed https://x.test?apiKey=secret123");
        },
      }),
    };

    const result = await runCodexAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });

    expect(result.harnessStopReason).toContain("apiKey=[redacted]");
    expect(result.codexStopReason).toContain("apiKey=[redacted]");
    expect(result.error).toContain("apiKey=[redacted]");
  });

  it("recovers usage from the isolated CODEX_HOME rollout when the step budget aborts the turn", async () => {
    const codexHome = await fsp.mkdtemp(path.join(os.tmpdir(), "codex-home-"));
    const sessionsDir = path.join(codexHome, "sessions", "2026", "08", "31");
    await fsp.mkdir(sessionsDir, { recursive: true });
    await fsp.writeFile(
      path.join(sessionsDir, "rollout-2026-08-31T10-00-00-thread-7e1047f4.jsonl"),
      JSON.stringify({
        type: "event_msg",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 2_000_000,
              cached_input_tokens: 1_900_000,
              output_tokens: 40_000,
              reasoning_output_tokens: 10_000,
              total_tokens: 2_040_000,
            },
          },
        },
      }) + "\n",
    );
    const previous = process.env.EVAL_CODEX_MAX_STEPS;
    process.env.EVAL_CODEX_MAX_STEPS = "1";
    try {
      const sdk: CodexSdk = {
        startThread: () => ({
          runStreamed: async () => ({
            events: (async function* () {
              yield { type: "thread.started", thread_id: "thread-7e1047f4" };
              yield { type: "item.completed", item: { type: "command_execution", command: "ls" } };
            })(),
          }),
        }),
      };
      const result = await runCodexAgent({
        plan,
        model: "openai/gpt-5.4-mini" as AvailableModel,
        logger: new EvalLogger(false),
        sdk,
        toolAdapter: {
          toolSurface: "browse_cli",
          startupProfile: "tool_launch_local",
          browserSession: { provider: "local" },
          cwd: "/tmp/stagehand-evals-test",
          env: { PATH: "/tmp", CODEX_HOME: codexHome },
          promptInstructions: "Use browse.",
          metadata: { toolCommand: "browse", browseCliEntrypoint: "/tmp/browse" },
          cleanup: async () => {},
        },
      });
      const metrics = result.metrics as Record<string, { value: number }>;

      expect(result.harnessStatus).toBe("max_turns");
      expect(metrics.codex_usage_recovered.value).toBe(1);
      expect(metrics.codex_input_tokens.value).toBe(2_000_000);
      expect(metrics.usage_input_total.value).toBe(2_000_000);
      expect(metrics.usage_input_cached.value).toBe(1_900_000);
      expect(metrics.usage_output.value).toBe(40_000);
      expect(metrics.cost_usd_estimated.value).toBeGreaterThan(0);
    } finally {
      if (previous === undefined) delete process.env.EVAL_CODEX_MAX_STEPS;
      else process.env.EVAL_CODEX_MAX_STEPS = previous;
    }
  });
});
