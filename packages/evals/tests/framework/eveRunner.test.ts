/* eslint-disable require-yield */
import { describe, expect, it } from "vitest";
import type { EveClientLike, EveEvent } from "@browserbasehq/stagehand-integrations-eve-sdk";
import type { AvailableModel } from "stagehand-v3";
import { buildEvePrompt, parseEveResult, runEveAgent } from "../../framework/eveRunner.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EvalLogger } from "../../logger.js";

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

function fakeClient(events: EveEvent[]): EveClientLike {
  return {
    health: async () => ({}),
    session: () => ({
      cancel: async () => ({}),
      send: async () =>
        Object.assign(
          {
            async *[Symbol.asyncIterator]() {
              yield* events;
            },
          },
          { sessionId: "eve-session" },
        ),
    }),
  };
}

describe("Eve runner helpers", () => {
  it("builds the shared structured-result browser prompt", () => {
    const prompt = buildEvePrompt(plan, "Use the mounted Eve tools.");
    expect(prompt).toContain("Dataset: webvoyager");
    expect(prompt).toContain("Task ID: wv-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find the checkout button");
    expect(prompt).toContain("Use the mounted Eve tools.");
    expect(prompt).toContain('"success": boolean');
  });

  it("parses direct and marker JSON results", () => {
    expect(parseEveResult('{"success":true,"summary":"done","finalAnswer":"ok"}')).toMatchObject({
      success: true,
      summary: "done",
      finalAnswer: "ok",
    });
    expect(parseEveResult('text\nEVAL_RESULT: {"success":true,"summary":"legacy"}')).toMatchObject({
      success: true,
      summary: "legacy",
    });
  });

  it("streams an Eve turn into native and normalized metrics", async () => {
    const client = fakeClient([
      {
        type: "step.completed",
        data: {
          usage: {
            inputTokens: 100,
            outputTokens: 25,
            cacheReadTokens: 10,
            cacheWriteTokens: 4,
            costUsd: 0.12,
          },
        },
      },
      {
        type: "message.completed",
        data: {
          message: '{"success":true,"summary":"done","finalAnswer":"clicked"}',
        },
      },
      { type: "turn.completed" },
    ]);
    const result = await runEveAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      client,
      serverUrl: "http://eve",
    });
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(result._success).toBe(true);
    expect(result.eveStatus).toBe("completed");
    expect(result.harnessStatus).toBe("completed");
    expect(result.finalAnswer).toBe("clicked");
    expect(metrics.eve_input_tokens.value).toBe(100);
    expect(metrics.eve_output_tokens.value).toBe(25);
    expect(metrics.eve_cache_read_tokens.value).toBe(10);
    expect(metrics.eve_cache_write_tokens.value).toBe(4);
    expect(metrics.eve_total_tokens.value).toBe(139);
    expect(metrics.eve_cost_usd.value).toBe(0.12);
    expect(metrics.harness_input_tokens.value).toBe(100);
    expect(metrics.harness_cached_input_tokens.value).toBe(10);
    expect(metrics.harness_cache_creation_input_tokens.value).toBe(4);
    expect(metrics.harness_output_tokens.value).toBe(25);
    expect(metrics.harness_total_tokens.value).toBe(139);
    expect(metrics.harness_cost_usd.value).toBe(0.12);
    expect(metrics.step_budget.value).toBe(50);
  });

  it("uses the dataset step budget on HardBench and reports it as a metric", async () => {
    const previous = {
      EVAL_EVE_MAX_STEPS: process.env.EVAL_EVE_MAX_STEPS,
      AGENT_EVAL_MAX_STEPS: process.env.AGENT_EVAL_MAX_STEPS,
    };
    delete process.env.EVAL_EVE_MAX_STEPS;
    delete process.env.AGENT_EVAL_MAX_STEPS;
    try {
      const result = await runEveAgent({
        plan: { ...plan, dataset: "hardbenchmark" },
        model: "openai/gpt-5.4-mini" as AvailableModel,
        logger: new EvalLogger(false),
        client: fakeClient([
          {
            type: "message.completed",
            data: { message: '{"success":true,"summary":"done","finalAnswer":"ok"}' },
          },
          { type: "turn.completed" },
        ]),
        serverUrl: "http://eve",
      });
      const metrics = result.metrics as Record<string, { value: number }>;
      expect(metrics.step_budget.value).toBe(75);
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it("redacts secrets from tool results before copying the transcript into rawResult", async () => {
    const client = fakeClient([
      {
        type: "action.result",
        data: {
          status: "completed",
          result: {
            kind: "tool-result",
            toolName: "stagehand__run",
            output: "key sk-abc123SUPERSECRET",
          },
        },
      },
      {
        type: "message.completed",
        data: { message: '{"success":true,"summary":"done"}' },
      },
      { type: "turn.completed" },
    ]);

    const result = await runEveAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      client,
      serverUrl: "http://eve",
    });

    expect(result.rawResult).toContain("sk-abc123[redacted]");
    expect(result.rawResult).not.toContain("SUPERSECRET");
  });

  it("returns a failed task result when Eve send throws", async () => {
    const client: EveClientLike = {
      health: async () => ({}),
      session: () => ({
        cancel: async () => ({}),
        send: async () => {
          throw new Error("eve send failed with sk-abc123SUPERSECRET");
        },
      }),
    };
    const result = await runEveAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      client,
      serverUrl: "http://eve",
    });
    expect(result._success).toBe(false);
    expect(result.eveStatus).toBe("sdk_error");
    expect(result.harnessStatus).toBe("sdk_error");
    expect(result.harnessStopReason).toBeDefined();
    expect(result.error).toEqual(expect.stringContaining("eve send failed"));
    expect(JSON.stringify(result)).toContain("sk-abc123[redacted]");
    expect(JSON.stringify(result)).not.toContain("SUPERSECRET");
  });

  it("rejects when no generated app or server URL is available", async () => {
    await expect(
      runEveAgent({
        plan,
        model: "openai/gpt-5.4-mini" as AvailableModel,
        logger: new EvalLogger(false),
      }),
    ).rejects.toThrow("Eve harness needs a prepared tool adapter (generated app) or a serverUrl.");
  });
});
