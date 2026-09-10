/* eslint-disable require-yield */
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as eveSdk from "@browserbasehq/stagehand-integrations-eve-sdk";
import type { EveClientLike, EveEvent } from "@browserbasehq/stagehand-integrations-eve-sdk";
import type { AvailableModel } from "stagehand-v3";
import {
  buildEvePrompt,
  parseEveResult,
  runEveAgent,
  sanitizeEveSessionResult,
} from "../../framework/eveRunner.js";
import { buildEveAgentAppFiles } from "../../framework/eveToolAdapter.js";
import { EVAL_SYSTEM_PROMPT } from "../../framework/evalSystemPrompt.js";
import type { ExternalHarnessTaskPlan } from "../../framework/externalHarnessPlan.js";
import { EvalLogger } from "../../logger.js";

afterEach(() => vi.unstubAllEnvs());

const plan: ExternalHarnessTaskPlan = {
  dataset: "webvoyager",
  taskId: "wv-1",
  startUrl: "https://example.com",
  instruction: "Find the checkout button",
};

function fakeClient(events: EveEvent[], onPrompt?: (prompt: string) => void): EveClientLike {
  return {
    health: async () => ({}),
    session: () => ({
      cancel: async () => ({}),
      send: async ({ message }) => {
        onPrompt?.(message);
        return Object.assign(
          {
            async *[Symbol.asyncIterator]() {
              yield* events;
            },
          },
          { sessionId: "eve-session" },
        );
      },
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
    vi.stubEnv("EVAL_EVE_MAX_STEPS", undefined);
    vi.stubEnv("AGENT_EVAL_MAX_STEPS", undefined);
    const onPrompt = vi.fn();
    const client = fakeClient(
      [
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
      ],
      onPrompt,
    );
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
    expect(onPrompt).toHaveBeenCalledTimes(1);
    const sentPrompt = onPrompt.mock.calls[0][0] as string;
    expect(sentPrompt.startsWith(`${EVAL_SYSTEM_PROMPT}\n\n`)).toBe(true);
    expect(sentPrompt.split(EVAL_SYSTEM_PROMPT)).toHaveLength(2);
    expect(sentPrompt).toContain(plan.instruction);
  });

  it.each([false, true])(
    "uses the directive once with a generated adapter (external server override: %s)",
    async (useExternalServer) => {
      const appRoot = await fsp.mkdtemp(path.join(os.tmpdir(), "eve-runner-system-prompt-"));
      const instructions = buildEveAgentAppFiles({
        instructions: "Use the mounted browser tools.",
        servers: {},
      })["agent/instructions.md"];
      await fsp.mkdir(path.join(appRoot, "agent"));
      await fsp.writeFile(path.join(appRoot, "agent", "instructions.md"), instructions);
      const realRunEveSession = eveSdk.runEveSession;
      // Only substitute server startup: the real session implementation must
      // still deliver the runner's prompt to the recording client.send call.
      const sessionSpy = vi.spyOn(eveSdk, "runEveSession").mockImplementationOnce((input) => {
        expect(input.server).toHaveProperty(
          useExternalServer ? "url" : "appRoot",
          useExternalServer ? "http://external-eve" : appRoot,
        );
        return realRunEveSession({ ...input, server: { url: "http://recording-eve" } });
      });
      const onPrompt = vi.fn();
      try {
        const result = await runEveAgent({
          plan,
          model: "openai/gpt-5.4-mini" as AvailableModel,
          logger: new EvalLogger(false),
          toolAdapter: {
            toolSurface: "stagehand_facade",
            startupProfile: "tool_launch_local",
            browserSession: { provider: "local" },
            appRoot,
            env: {},
            promptInstructions: "Use the mounted browser tools.",
            serverNames: [],
            toolNames: [],
            observedToolMatcher: () => false,
            cleanup: async () => {},
          },
          ...(useExternalServer && { serverUrl: "http://external-eve" }),
          client: fakeClient(
            [
              {
                type: "message.completed",
                data: { message: '{"success":true,"summary":"done","finalAnswer":"ok"}' },
              },
              { type: "turn.completed" },
            ],
            onPrompt,
          ),
        });
        expect(result._success).toBe(true);
        expect(onPrompt).toHaveBeenCalledTimes(1);
        const taskPrompt = onPrompt.mock.calls[0][0] as string;
        expect(taskPrompt).toContain(plan.instruction);
        expect(taskPrompt.includes(EVAL_SYSTEM_PROMPT)).toBe(useExternalServer);
        // An external server does not load this adapter's generated app.
        const systemPrompt = useExternalServer
          ? ""
          : await fsp.readFile(path.join(appRoot, "agent", "instructions.md"), "utf8");
        expect(`${systemPrompt}\n${taskPrompt}`.split(EVAL_SYSTEM_PROMPT)).toHaveLength(2);
        expect(systemPrompt).not.toContain("Never ask the user questions");
      } finally {
        sessionSpy.mockRestore();
        await fsp.rm(appRoot, { recursive: true, force: true });
      }
    },
  );

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
      expect(metrics.step_budget.value).toBe(100);
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

  it("redacts structured event payloads before trajectory conversion", () => {
    const sanitized = sanitizeEveSessionResult({
      events: [
        {
          type: "action.result",
          data: {
            result: {
              kind: "tool-result",
              output: { token: "sk-abc123SUPERSECRET" },
            },
          },
        },
      ],
      finalMessage: "done sk-abc123SUPERSECRET",
      status: "completed",
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: 0,
      },
    });

    expect(JSON.stringify(sanitized)).toContain("sk-abc123[redacted]");
    expect(JSON.stringify(sanitized)).not.toContain("SUPERSECRET");
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
    expect(result.error).toBe("Eve session failed.");
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

it.each([false, true])(
  "preserves token usage presence through eve grading (reported=%s)",
  async (reported) => {
    const finalAnswer = 'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"ok"}';
    const result = await runEveAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      serverUrl: "http://eve",
      client: fakeClient([
        {
          type: "step.completed",
          data: { ...(reported && { usage: { inputTokens: 0, outputTokens: 0 } }) },
        },
        { type: "message.completed", data: { message: finalAnswer } },
        { type: "turn.completed" },
      ]),
    });
    expect(result.usageConvention).toBe(reported ? "openai_cached_subset" : "unreported");
    if (!reported) {
      expect(result.cost_source).toBe("unavailable");
      expect(result.cost_usd).toBeUndefined();
    }
  },
);
