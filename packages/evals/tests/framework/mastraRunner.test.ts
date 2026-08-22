import { describe, expect, it } from "vitest";
import type { AvailableModel } from "stagehand-v3";
import type { MastraEvent, MastraSdk } from "@browserbasehq/stagehand-integrations-mastra-sdk";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import {
  buildMastraPrompt,
  parseMastraResult,
  runMastraAgent,
} from "../../framework/mastraRunner.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

describe("Mastra runner", () => {
  it("builds the benchmark prompt and result schema", () => {
    const prompt = buildMastraPrompt(plan, "Use Stagehand via MCP.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find the checkout button");
    expect(prompt).toContain("Use Stagehand via MCP.");
    expect(prompt).toContain('"success": boolean');
  });

  it("parses direct JSON results", () => {
    expect(parseMastraResult('{"success":true,"summary":"done","finalAnswer":"clicked"}')).toEqual({
      success: true,
      summary: "done",
      finalAnswer: "clicked",
      raw: '{"success":true,"summary":"done","finalAnswer":"clicked"}',
    });
  });

  it("parses EVAL_RESULT marker JSON", () => {
    expect(
      parseMastraResult('assistant text\nEVAL_RESULT: {"success":true,"summary":"done"}'),
    ).toMatchObject({ success: true, summary: "done" });
  });

  it("streams a successful result, reports metrics, and forwards session options", async () => {
    let agentConfig: Record<string, unknown> | undefined;
    let streamOptions: Record<string, unknown> | undefined;
    let mcpServers: Record<string, unknown> | undefined;
    const sdk = fakeSdk(
      [
        {
          type: "tool-call",
          payload: { toolCallId: "1", toolName: "stagehand_run", args: {} },
        },
        {
          type: "tool-result",
          payload: { toolCallId: "1", toolName: "stagehand_run", result: "done" },
        },
        {
          type: "text-delta",
          payload: {
            text: '{"success":true,"summary":"done","finalAnswer":"ok"}',
          },
        },
        { type: "step-finish", payload: { output: { usage: {} } } },
        {
          type: "finish",
          payload: {
            stepResult: { reason: "stop" },
            output: {
              usage: {
                inputTokens: 100,
                cachedInputTokens: 10,
                outputTokens: 25,
                reasoningTokens: 5,
              },
            },
          },
        },
      ],
      {
        agentConfig: (value) => (agentConfig = value),
        streamOptions: (value) => (streamOptions = value),
        mcpServers: (value) => (mcpServers = value),
      },
    );
    const result = await runMastraAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
      toolAdapter: {
        toolSurface: "stagehand_facade",
        startupProfile: "tool_launch_local",
        cwd: "/tmp/mastra-test",
        promptInstructions: "Use Stagehand.",
        mcpServers: { stagehand: { command: "node", args: ["server.mjs"] } },
        cleanup: async () => {},
      },
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(result._success).toBe(true);
    expect(result.harnessStatus).toBe("completed");
    expect(result.mastraStatus).toBe("completed");
    expect(result.finalAnswer).toBe("ok");
    expect(agentConfig).toMatchObject({ model: "openai/gpt-5.4-mini" });
    expect(agentConfig?.instructions).not.toBe("Use Stagehand.");
    expect(streamOptions).toMatchObject({ maxSteps: 50 });
    expect(mcpServers?.stagehand).toMatchObject({ command: "node", onToolError: "return" });
    expect(metrics.harness_input_tokens.value).toBe(100);
    expect(metrics.harness_cached_input_tokens.value).toBe(10);
    expect(metrics.harness_output_tokens.value).toBe(25);
    expect(metrics.harness_reasoning_output_tokens.value).toBe(5);
    expect(metrics.harness_total_tokens.value).toBe(125);
    expect(metrics.harness_cost_usd).toBeUndefined();
    expect(Object.keys(metrics).some((key) => key.startsWith("mastra_"))).toBe(false);
  });

  it("returns a failed task result for SDK errors", async () => {
    const sdk = fakeSdk([], { streamError: new Error("mastra failed") });
    const result = await runMastraAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.mastraStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBeDefined();
    expect(String(result.error)).toContain("mastra failed");
  });

  it("does not accept success JSON emitted before an SDK error", async () => {
    const sdk = fakeSdk([
      {
        type: "text-delta",
        payload: { text: '{"success":true,"summary":"done","finalAnswer":"x"}' },
      },
      { type: "error", payload: { error: "boom" } },
    ]);
    const result = await runMastraAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      sdk,
    });
    expect(result._success).toBe(false);
    expect(result.harnessStatus).toBe("sdk_error");
    expect(String(result.error)).toContain("boom");
  });
});

function fakeSdk(
  events: MastraEvent[],
  options: {
    agentConfig?: (config: Record<string, unknown>) => void;
    streamOptions?: (options: Record<string, unknown> | undefined) => void;
    mcpServers?: (servers: Record<string, unknown>) => void;
    streamError?: Error;
  } = {},
): MastraSdk {
  return {
    createAgent: (config: Record<string, unknown>) => {
      options.agentConfig?.(config);
      return {
        stream: async (_prompt: string, streamOptions?: Record<string, unknown>) => {
          options.streamOptions?.(streamOptions);
          if (options.streamError) throw options.streamError;
          return {
            fullStream: (async function* () {
              yield* events;
            })(),
          };
        },
      };
    },
    createMcpClient: (clientOptions: Parameters<MastraSdk["createMcpClient"]>[0]) => {
      options.mcpServers?.(clientOptions.servers);
      return {
        listToolsWithErrors: async () => ({ tools: {}, errors: {} }),
        disconnect: async () => {},
      };
    },
    createTool: (toolOptions: Parameters<MastraSdk["createTool"]>[0]) => toolOptions,
  };
}
