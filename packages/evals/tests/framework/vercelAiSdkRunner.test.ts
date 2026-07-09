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
  resolveVercelAiSdkModel,
  runVercelAiSdkAgent,
} from "../../framework/vercelAiSdkRunner.js";

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
  delete process.env.EVAL_VERCEL_AI_SDK_MAX_STEPS;
});

async function makeAdapter(): Promise<PreparedExternalHarnessAdapter> {
  tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-vercel-test-"),
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

describe("vercel_ai_sdk runner", () => {
  it("requires a provider-prefixed model", () => {
    expect(() =>
      resolveVercelAiSdkModel("claude-sonnet-4-6" as AvailableModel),
    ).toThrow(/provider-prefixed/);
  });

  it("drives the loop through generateText with the bare system prompt and records tool calls", async () => {
    const adapter = await makeAdapter();
    process.env.EVAL_VERCEL_AI_SDK_MAX_STEPS = "7";
    let captured: Record<string, unknown> | undefined;

    const result = await runVercelAiSdkAgent({
      plan,
      model: "anthropic/claude-sonnet-4-6" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      generateTextFn: async (options) => {
        captured = options;
        const tools = options.tools as Record<
          string,
          { execute: (input: { args: string }) => Promise<string> }
        >;
        const first = await tools.browse.execute({ args: "--help" });
        expect(first).toContain("browse-output:--help");
        await tools.browse.execute({ args: "open https://example.com" });
        return {
          text: 'done\nEVAL_RESULT: {"success":true,"summary":"found it","finalAnswer":"checkout"}',
          steps: [{}, {}, {}],
          totalUsage: { inputTokens: 120, outputTokens: 30 },
        };
      },
    });

    expect(captured?.system).toBe(BARE_LOOP_DEFAULT_SYSTEM_PROMPT);
    expect(String(captured?.prompt)).toContain("Find the checkout button");
    expect(String(captured?.prompt)).toContain(
      "Start URL: https://example.com",
    );
    expect(result._success).toBe(true);
    expect(result.finalAnswer).toBe("checkout");
    expect(result.vercel_ai_sdkStatus).toBe("completed");
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(metrics.vercel_ai_sdk_tool_calls.value).toBe(2);
    expect(metrics.vercel_ai_sdk_steps.value).toBe(3);
    expect(metrics.vercel_ai_sdk_max_steps.value).toBe(7);
    expect(metrics.vercel_ai_sdk_input_tokens.value).toBe(120);
    expect(metrics.vercel_ai_sdk_output_tokens.value).toBe(30);
  });

  it("returns a failed task result instead of throwing on loop errors", async () => {
    const adapter = await makeAdapter();
    const result = await runVercelAiSdkAgent({
      plan,
      model: "anthropic/claude-sonnet-4-6" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      generateTextFn: async () => {
        throw new Error("provider exploded");
      },
    });

    expect(result._success).toBe(false);
    expect(result.vercel_ai_sdkStatus).toBe("error");
    expect(result.vercel_ai_sdkStopReason).toContain("provider exploded");
  });
});
