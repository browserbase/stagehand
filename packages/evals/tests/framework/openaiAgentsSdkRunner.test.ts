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
  normalizeOpenAiAgentsModel,
  runOpenAiAgentsSdkAgent,
  type OpenAiAgentsSdk,
} from "../../framework/openaiAgentsSdkRunner.js";

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
  delete process.env.EVAL_OPENAI_AGENTS_SDK_MAX_TURNS;
});

async function makeAdapter(): Promise<PreparedExternalHarnessAdapter> {
  tempDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "stagehand-evals-agents-test-"),
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

describe("openai_agents_sdk runner", () => {
  it("normalizes openai-prefixed models and rejects other providers", () => {
    expect(
      normalizeOpenAiAgentsModel("openai/gpt-5.4-mini" as AvailableModel),
    ).toBe("gpt-5.4-mini");
    expect(normalizeOpenAiAgentsModel("gpt-5.4" as AvailableModel)).toBe(
      "gpt-5.4",
    );
    expect(() =>
      normalizeOpenAiAgentsModel(
        "anthropic/claude-sonnet-4-6" as AvailableModel,
      ),
    ).toThrow(/only accepts openai models/);
  });

  it("passes dev instructions + maxTurns only, and records tool executions", async () => {
    const adapter = await makeAdapter();
    process.env.EVAL_OPENAI_AGENTS_SDK_MAX_TURNS = "9";

    let capturedAgentConfig: Record<string, unknown> | undefined;
    let capturedToolOptions: Record<string, unknown> | undefined;
    let capturedRunOptions: Record<string, unknown> | undefined;
    let capturedInput: string | undefined;

    const sdk: OpenAiAgentsSdk = {
      tool: (options) => {
        capturedToolOptions = options;
        return { __tool: true, options };
      },
      Agent: class {
        constructor(config: Record<string, unknown>) {
          capturedAgentConfig = config;
        }
      } as unknown as OpenAiAgentsSdk["Agent"],
      run: async (agent, input, options) => {
        void agent;
        capturedInput = input;
        capturedRunOptions = options;
        const execute = capturedToolOptions?.execute as (
          params: unknown,
        ) => Promise<string>;
        const output = await execute({ args: "open https://example.com" });
        expect(output).toContain("browse-output:open https://example.com");
        return {
          finalOutput:
            'EVAL_RESULT: {"success":true,"summary":"done","finalAnswer":"checkout"}',
          rawResponses: [
            { usage: { inputTokens: 100, outputTokens: 25 } },
            { usage: { inputTokens: 40, outputTokens: 10 } },
          ],
        };
      },
    };

    const result = await runOpenAiAgentsSdkAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      sdk,
    });

    // Dev-supplied instructions ARE the skill-arm prompt — nothing else.
    expect(capturedAgentConfig?.instructions).toBe(
      BARE_LOOP_DEFAULT_SYSTEM_PROMPT,
    );
    expect(capturedAgentConfig?.model).toBe("gpt-5.4-mini");
    expect(capturedRunOptions?.maxTurns).toBe(9);
    expect(capturedInput).toContain("Find the checkout button");
    expect(result._success).toBe(true);
    expect(result.finalAnswer).toBe("checkout");
    const metrics = result.metrics as Record<string, { value: number }>;
    expect(metrics.openai_agents_sdk_tool_calls.value).toBe(1);
    expect(metrics.openai_agents_sdk_input_tokens.value).toBe(140);
    expect(metrics.openai_agents_sdk_output_tokens.value).toBe(35);
  });

  it("returns a failed task result instead of throwing on SDK errors", async () => {
    const adapter = await makeAdapter();
    const sdk: OpenAiAgentsSdk = {
      tool: (options) => ({ options }),
      Agent: class {} as unknown as OpenAiAgentsSdk["Agent"],
      run: async () => {
        throw new Error("Max turns (40) exceeded");
      },
    };

    const result = await runOpenAiAgentsSdkAgent({
      plan,
      model: "openai/gpt-5.4-mini" as AvailableModel,
      logger: new EvalLogger(false),
      toolAdapter: adapter,
      sdk,
    });

    expect(result._success).toBe(false);
    expect(result.openai_agents_sdkStatus).toBe("error");
    expect(result.openai_agents_sdkStopReason).toContain("Max turns");
  });
});
