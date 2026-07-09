import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AvailableModel } from "@browserbasehq/stagehand";
import { EvalLogger } from "../../logger.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import type { PreparedExternalHarnessAdapter } from "../../framework/externalHarnessToolAdapter.js";
import { BARE_LOOP_DEFAULT_SYSTEM_PROMPT } from "../../framework/externalHarnessToolAdapter.js";
import {
  normalizeAnthropicModel,
  runAnthropicSdkAgent,
  type AnthropicMessageResponse,
} from "../../framework/anthropicSdkRunner.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webtailbench",
  taskId: "wtb-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await fsp.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  delete process.env.EVAL_ANTHROPIC_SDK_MAX_STEPS;
});

async function makeAdapter(): Promise<PreparedExternalHarnessAdapter> {
  tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-anthropic-test-"),
  );
  const bin = path.join(tempDir, "browse");
  await fsp.writeFile(bin, '#!/usr/bin/env bash\necho "browse-output:$@"\n', {
    mode: 0o755,
  });
  return {
    cwd: tempDir,
    env: { ...process.env } as Record<string, string>,
    browseBinPath: bin,
    skillMode: "none",
    systemPromptAddendum: BARE_LOOP_DEFAULT_SYSTEM_PROMPT,
    metadata: { toolCommand: "browse", browseCliEntrypoint: bin },
    cleanup: async () => {},
  };
}

describe("anthropic_sdk runner", () => {
  it("normalizes anthropic-prefixed models and rejects other providers", () => {
    expect(
      normalizeAnthropicModel("anthropic/claude-sonnet-4-6" as AvailableModel),
    ).toBe("claude-sonnet-4-6");
    expect(normalizeAnthropicModel("claude-haiku-4-5" as AvailableModel)).toBe(
      "claude-haiku-4-5",
    );
    expect(() =>
      normalizeAnthropicModel("openai/gpt-5.4" as AvailableModel),
    ).toThrow(/only accepts anthropic models/);
  });

  it("hand-rolls the tool_use loop: executes tools, threads tool_results, stops on end_turn", async () => {
    const adapter = await makeAdapter();
    const requests: Array<Record<string, unknown>> = [];
    const responses: AnthropicMessageResponse[] = [
      {
        content: [
          { type: "text", text: "Let me check the help." },
          {
            type: "tool_use",
            id: "tu-1",
            name: "browse",
            input: { args: "--help" },
          },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 50, output_tokens: 10 },
      },
      {
        content: [
          {
            type: "text",
            text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"checkout"}',
          },
        ],
        stop_reason: "end_turn",
        usage: { input_tokens: 80, output_tokens: 20 },
      },
    ];

    const result = await runAnthropicSdkAgent({
      plan,
      model: "anthropic/claude-sonnet-4-6" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      client: {
        messages: {
          create: async (params) => {
            requests.push(params);
            return responses[requests.length - 1];
          },
        },
      },
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].system).toBe(BARE_LOOP_DEFAULT_SYSTEM_PROMPT);
    expect(requests[0].model).toBe("claude-sonnet-4-6");
    // Second request must carry assistant tool_use + user tool_result turns.
    const secondMessages = requests[1].messages as Array<
      Record<string, unknown>
    >;
    expect(secondMessages).toHaveLength(3);
    expect(secondMessages[1].role).toBe("assistant");
    const toolResults = secondMessages[2].content as Array<
      Record<string, unknown>
    >;
    expect(toolResults[0].type).toBe("tool_result");
    expect(toolResults[0].tool_use_id).toBe("tu-1");
    expect(String(toolResults[0].content)).toContain("browse-output:--help");

    expect(result._success).toBe(true);
    expect(result.finalAnswer).toBe("checkout");
    expect(result.anthropicSdkStatus).toBe("completed");
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(metrics.anthropic_sdk_tool_calls.value).toBe(1);
    expect(metrics.anthropic_sdk_input_tokens.value).toBe(130);
    expect(metrics.anthropic_sdk_output_tokens.value).toBe(30);
  });

  it("stops at the step cap and reports it as the stop reason", async () => {
    const adapter = await makeAdapter();
    process.env.EVAL_ANTHROPIC_SDK_MAX_STEPS = "2";

    const result = await runAnthropicSdkAgent({
      plan,
      model: "anthropic/claude-sonnet-4-6" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      client: {
        messages: {
          create: async () => ({
            content: [
              {
                type: "tool_use",
                id: "tu-x",
                name: "browse",
                input: { args: "snapshot" },
              },
            ],
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        },
      },
    });

    expect(result._success).toBe(false);
    expect(result.anthropicSdkStopReason).toContain("step cap reached (2)");
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(metrics.anthropic_sdk_tool_calls.value).toBe(2);
    expect(metrics.anthropic_sdk_max_steps.value).toBe(2);
  });

  it("wires the caller's AbortSignal through to the SDK's native abort option", async () => {
    const adapter = await makeAdapter();
    const controller = new AbortController();
    const capturedOptions: Array<{ signal?: AbortSignal } | undefined> = [];

    await runAnthropicSdkAgent({
      plan,
      model: "anthropic/claude-sonnet-4-6" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      signal: controller.signal,
      client: {
        messages: {
          create: async (_params, options) => {
            capturedOptions.push(options);
            return {
              content: [
                {
                  type: "text",
                  text: 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"checkout"}',
                },
              ],
              stop_reason: "end_turn",
            };
          },
        },
      },
    });

    expect(capturedOptions).toHaveLength(1);
    // The SDK cancels the in-flight HTTP request via this signal instead of
    // us only polling `aborted` between requests.
    expect(capturedOptions[0]?.signal).toBe(controller.signal);
  });

  it("returns a failed task result instead of throwing on SDK errors", async () => {
    const adapter = await makeAdapter();
    const result = await runAnthropicSdkAgent({
      plan,
      model: "anthropic/claude-sonnet-4-6" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      client: {
        messages: {
          create: async () => {
            throw new Error("anthropic exploded");
          },
        },
      },
    });

    expect(result._success).toBe(false);
    expect(result.anthropicSdkStatus).toBe("error");
    expect(result.anthropicSdkStopReason).toContain("anthropic exploded");
  });
});
