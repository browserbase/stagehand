import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EvalLogger } from "../../logger.js";
import {
  buildBareLoopUserPrompt,
  createBareLoopToolRecorder,
  finalizeBareLoopResult,
  readToolOutputLimit,
  readToolTimeoutMs,
  stringifyLoopError,
} from "../../framework/bareLoopRunner.js";

let tempDir: string | undefined;

afterEach(async () => {
  if (tempDir) {
    await fsp.rm(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  }
  delete process.env.EVAL_BARE_LOOP_TOOL_OUTPUT_LIMIT;
  delete process.env.EVAL_BARE_LOOP_TOOL_TIMEOUT_MS;
});

async function makeBrowseBin(script: string): Promise<{
  cwd: string;
  browseBinPath: string;
  env: Record<string, string>;
}> {
  tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-bareloop-test-"),
  );
  const bin = path.join(tempDir, "browse");
  await fsp.writeFile(bin, script, { mode: 0o755 });
  return {
    cwd: tempDir,
    browseBinPath: bin,
    env: { ...process.env } as Record<string, string>,
  };
}

describe("env knobs", () => {
  it("readToolOutputLimit defaults and rejects invalid values", () => {
    expect(readToolOutputLimit()).toBe(20_000);
    process.env.EVAL_BARE_LOOP_TOOL_OUTPUT_LIMIT = "500";
    expect(readToolOutputLimit()).toBe(500);
    process.env.EVAL_BARE_LOOP_TOOL_OUTPUT_LIMIT = "-3";
    expect(readToolOutputLimit()).toBe(20_000);
    process.env.EVAL_BARE_LOOP_TOOL_OUTPUT_LIMIT = "not-a-number";
    expect(readToolOutputLimit()).toBe(20_000);
  });

  it("readToolTimeoutMs defaults and rejects invalid values", () => {
    expect(readToolTimeoutMs()).toBe(60_000);
    process.env.EVAL_BARE_LOOP_TOOL_TIMEOUT_MS = "1500";
    expect(readToolTimeoutMs()).toBe(1500);
    process.env.EVAL_BARE_LOOP_TOOL_TIMEOUT_MS = "0";
    expect(readToolTimeoutMs()).toBe(60_000);
  });
});

describe("createBareLoopToolRecorder", () => {
  it("records successful calls and clips output to the configured limit", async () => {
    process.env.EVAL_BARE_LOOP_TOOL_OUTPUT_LIMIT = "40";
    const adapter = await makeBrowseBin(
      '#!/usr/bin/env bash\nprintf "%0.sX" {1..200}\n',
    );
    const recorder = createBareLoopToolRecorder(
      adapter,
      new EvalLogger(false),
      "test_harness",
    );

    const output = await recorder.execute("open https://example.com");
    expect(output).toHaveLength(40);
    expect(recorder.calls).toHaveLength(1);
    expect(recorder.calls[0].ok).toBe(true);
    expect(recorder.calls[0].result).toBe(output);
    expect(recorder.calls[0].args).toEqual({
      args: "open https://example.com",
    });
  });

  it("records failing calls as ok:false with a clipped error", async () => {
    const adapter = await makeBrowseBin(
      '#!/usr/bin/env bash\necho "boom" >&2\nexit 1\n',
    );
    const recorder = createBareLoopToolRecorder(
      adapter,
      new EvalLogger(false),
      "test_harness",
    );

    const output = await recorder.execute("open https://example.com");
    expect(output).toContain("boom");
    expect(recorder.calls[0].ok).toBe(false);
    expect(recorder.calls[0].error).toContain("boom");
  });
});

describe("finalizeBareLoopResult", () => {
  it("camelCases the harness id in result field names and parses EVAL_RESULT", async () => {
    const result = await finalizeBareLoopResult({
      harness: "vercel_ai_sdk",
      toolCalls: [],
      finalText:
        'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"checkout"}',
      status: "complete",
      stepsUsed: 3,
      maxSteps: 40,
      logger: new EvalLogger(false),
    });

    expect(result._success).toBe(true);
    expect(result.finalAnswer).toBe("checkout");
    expect(result.vercelAiSdkStatus).toBe("completed");
    expect(result.vercelAiSdkStopReason).toBeUndefined();
    const metrics = result.metrics as Record<string, { value: number }>;
    // Metrics keys keep the snake_case harness id.
    expect(metrics.vercel_ai_sdk_steps.value).toBe(3);
    expect(metrics.vercel_ai_sdk_max_steps.value).toBe(40);
  });

  it("reports error status and stop reason for abnormal ends", async () => {
    const result = await finalizeBareLoopResult({
      harness: "anthropic_sdk",
      toolCalls: [],
      finalText: "",
      status: "error",
      stopReason: "provider exploded",
      stepsUsed: 1,
      maxSteps: 40,
      logger: new EvalLogger(false),
    });

    expect(result._success).toBe(false);
    expect(result.anthropicSdkStatus).toBe("error");
    expect(result.anthropicSdkStopReason).toBe("provider exploded");
    expect(result.error).toBe("provider exploded");
  });
});

describe("stringifyLoopError", () => {
  it("stringifies errors, strings, and objects", () => {
    expect(stringifyLoopError(new Error("kaput"))).toBe("kaput");
    expect(stringifyLoopError("plain")).toBe("plain");
    expect(stringifyLoopError({ code: 7 })).toBe('{"code":7}');
    expect(stringifyLoopError(undefined)).toBe("");
  });

  it("redacts API keys, bearer tokens, and signed query params", () => {
    expect(
      stringifyLoopError(
        new Error("401 for key sk-abcdefghijklmnop1234 (unauthorized)"),
      ),
    ).toBe("401 for key [redacted] (unauthorized)");
    expect(
      stringifyLoopError("Authorization: Bearer abc.def-ghi_jkl123 failed"),
    ).toBe("Authorization: Bearer [redacted] failed");
    expect(
      stringifyLoopError(
        "GET https://api.example.com/run?api_key=supersecretvalue&x=1 failed",
      ),
    ).toBe("GET https://api.example.com/run?api_key=[redacted]&x=1 failed");
    expect(stringifyLoopError("bb_live_0123456789abcdef broke")).toBe(
      "[redacted] broke",
    );
  });
});

describe("buildBareLoopUserPrompt", () => {
  it("includes dataset, start URL, instruction, and the EVAL_RESULT contract", () => {
    const prompt = buildBareLoopUserPrompt({
      dataset: "webtailbench",
      taskId: "wtb-1",
      startUrl: "https://example.com",
      instruction: "Find the checkout button",
    });
    expect(prompt).toContain("Dataset: webtailbench");
    expect(prompt).toContain("Task ID: wtb-1");
    expect(prompt).toContain("Start URL: https://example.com");
    expect(prompt).toContain("Find the checkout button");
    expect(prompt).toContain("EVAL_RESULT:");
  });
});
