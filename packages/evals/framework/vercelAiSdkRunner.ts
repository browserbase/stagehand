/**
 * vercelAiSdkRunner — bare-loop harness via the Vercel AI SDK (`ai` package).
 *
 * The loop is `generateText` with `stopWhen: stepCountIs(N)` and a single
 * `browse` tool — the AI SDK's own multi-step tool loop IS the harness, with
 * zero additional scaffolding. This mirrors the JS-default bare loop found in
 * the wild (and the Modal sandbox template used in the 2026-07-09 smoke).
 *
 * Testability: pass `generateTextFn` to drive the loop with a mock. The mock
 * receives the fully-built options (system, prompt, tools, stopWhen) and can
 * invoke `options.tools.browse.execute(...)` to exercise tool wiring.
 */
import type { AvailableModel } from "@browserbasehq/stagehand";
import { getAISDKLanguageModel } from "@browserbasehq/stagehand";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedExternalHarnessAdapter } from "./externalHarnessToolAdapter.js";
import { readBareLoopMaxSteps } from "./bareLoopConfig.js";
import {
  BROWSE_TOOL_DESCRIPTION,
  BROWSE_TOOL_NAME,
  buildBareLoopUserPrompt,
  createBareLoopToolRecorder,
  finalizeBareLoopResult,
  stringifyLoopError,
} from "./bareLoopRunner.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

const HARNESS = "vercel_ai_sdk";
const MAX_STEPS_ENV = "EVAL_VERCEL_AI_SDK_MAX_STEPS";

export interface VercelAiSdkGenerateTextResult {
  text: string;
  steps?: unknown[];
  totalUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    reasoningTokens?: number;
  };
  finishReason?: string;
}

export type VercelAiSdkGenerateTextFn = (
  options: Record<string, unknown>,
) => Promise<VercelAiSdkGenerateTextResult>;

export interface VercelAiSdkRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedExternalHarnessAdapter;
  signal?: AbortSignal;
  /** Injectable for unit tests; defaults to the real `ai` generateText. */
  generateTextFn?: VercelAiSdkGenerateTextFn;
  verifier?: ExternalHarnessVerifierConfig;
}

/**
 * Resolve "provider/model" to an AI SDK LanguageModel via stagehand's own
 * provider map — the exact resolution the `-m` flag already uses for the
 * stagehand harness, so model names mean the same thing on every harness.
 */
export function resolveVercelAiSdkModel(model: AvailableModel): unknown {
  if (!model.includes("/")) {
    throw new EvalsError(
      `vercel_ai_sdk harness requires a provider-prefixed model (e.g. anthropic/claude-sonnet-4-6); received "${model}".`,
    );
  }
  const slash = model.indexOf("/");
  return getAISDKLanguageModel(model.slice(0, slash), model.slice(slash + 1));
}

export async function runVercelAiSdkAgent(
  input: VercelAiSdkRunnerInput,
): Promise<TaskResult> {
  const maxSteps = readBareLoopMaxSteps(MAX_STEPS_ENV);
  const recorder = createBareLoopToolRecorder(
    input.toolAdapter,
    input.logger,
    HARNESS,
  );

  let finalText = "";
  let stepsUsed = 0;
  let usage: VercelAiSdkGenerateTextResult["totalUsage"];
  let loopError: unknown;
  let cappedOut = false;

  try {
    const ai = await import("ai");
    const { z } = await import("zod");
    const generateTextFn =
      input.generateTextFn ??
      (ai.generateText as unknown as VercelAiSdkGenerateTextFn);

    const result = await generateTextFn({
      model:
        input.generateTextFn === undefined
          ? resolveVercelAiSdkModel(input.model)
          : input.model,
      system: input.toolAdapter.systemPromptAddendum,
      prompt: buildBareLoopUserPrompt(input.plan),
      stopWhen: ai.stepCountIs(maxSteps),
      ...(input.signal && { abortSignal: input.signal }),
      tools: {
        [BROWSE_TOOL_NAME]: ai.tool({
          description: BROWSE_TOOL_DESCRIPTION,
          inputSchema: z.object({
            args: z
              .string()
              .describe(
                'Everything after "browse", e.g. "open https://example.com".',
              ),
          }),
          execute: async ({ args }: { args: string }) => recorder.execute(args),
        }),
      },
    });

    finalText = result.text ?? "";
    stepsUsed = result.steps?.length ?? 0;
    usage = result.totalUsage;
    // stopWhen: stepCountIs(maxSteps) ends the loop silently -- generateText
    // returns normally either way, so a clean stop and a cap-truncated one are
    // otherwise indistinguishable. finishReason on the last step is "stop"
    // when the model was actually done, or "tool-calls" when it still wanted
    // to call a tool but the step cap cut it off first. Mirrors anthropic_sdk's
    // stopReason shape so all bare-loop harnesses report the cap the same way.
    cappedOut = stepsUsed >= maxSteps && result.finishReason === "tool-calls";
  } catch (error) {
    loopError = error;
    input.logger.warn({
      category: HARNESS,
      message: `vercel_ai_sdk loop stopped before a normal result: ${stringifyLoopError(error)}`,
      level: 0,
    });
  }

  return finalizeBareLoopResult({
    harness: HARNESS,
    toolCalls: recorder.calls,
    finalText,
    status: loopError ? "error" : "complete",
    stopReason: loopError
      ? stringifyLoopError(loopError)
      : cappedOut
        ? `step cap reached (${maxSteps})`
        : undefined,
    usage: {
      input_tokens: usage?.inputTokens ?? 0,
      output_tokens: usage?.outputTokens ?? 0,
      ...(usage?.cachedInputTokens !== undefined && {
        cached_input_tokens: usage.cachedInputTokens,
      }),
      ...(usage?.reasoningTokens !== undefined && {
        reasoning_tokens: usage.reasoningTokens,
      }),
    },
    stepsUsed,
    maxSteps,
    logger: input.logger,
    verifier: input.verifier,
  });
}
