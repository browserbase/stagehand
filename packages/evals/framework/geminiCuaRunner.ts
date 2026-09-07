import {
  buildGeminiCuaTranscript,
  runGeminiCuaSession,
  type GeminiGenerateClient,
} from "@browserbasehq/stagehand-integrations-gemini-cua-sdk";
import type { AvailableModel } from "stagehand-v3";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { PreparedGeminiCuaToolAdapter } from "./geminiCuaToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  runExternalHarnessTask,
} from "./harnesses/externalRunner.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";
import { geminiCuaAdapter } from "./harnesses/geminiCuaAdapter.js";
export const GEMINI_CUA_DEFAULT_MODELS: AvailableModel[] = [
  "google/gemini-3.8-flash" as AvailableModel,
];
export const GEMINI_CUA_SYSTEM_PROMPT =
  "You are being evaluated on a browser task. Complete it with computer use only and finish by printing the requested EVAL_RESULT line.";
export interface GeminiCuaRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedGeminiCuaToolAdapter;
  signal?: AbortSignal;
  verifier?: ExternalHarnessVerifierConfig;
  client?: GeminiGenerateClient;
}
export function buildGeminiCuaPrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({ plan, toolInstructions, resultContract: "marker" });
}
export function assertGeminiCuaModel(model: string): void {
  const bare = model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
  const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : undefined;
  if ((provider !== undefined && provider !== "google") || !bare.startsWith("gemini-"))
    throw new EvalsError(`gemini_cua runs Google Gemini models only (received "${model}").`);
}
export async function runGeminiCuaAgent(input: GeminiCuaRunnerInput): Promise<TaskResult> {
  assertGeminiCuaModel(input.model);
  const maxTurns = resolveStepBudget({
    harnessEnvKey: "EVAL_GEMINI_CUA_MAX_STEPS",
    dataset: input.plan.dataset,
    harnessDefault: 50,
  });
  return runExternalHarnessTask({
    harness: "gemini_cua",
    plan: input.plan,
    model: input.model,
    logger: input.logger,
    toolAdapter: input.toolAdapter,
    verifier: input.verifier,
    resultContract: "marker",
    fallbackErrorMessage: "gemini_cua did not report success",
    stepBudget: maxTurns,
    stepBudgetUnit: "turns",
    systemPromptMode: "native",
    runSession: async (prompt, systemPrompt) => {
      const result = await runGeminiCuaSession({
        prompt,
        model: input.model,
        logger: input.logger,
        maxTurns,
        tools: input.toolAdapter.executor,
        facade: input.toolAdapter.facade,
        systemPrompt: `${systemPrompt}\n\n${GEMINI_CUA_SYSTEM_PROMPT}`,
        signal: input.signal,
        client: input.client,
      });
      return {
        raw: result,
        resultText: result.finalMessage,
        transcriptText: buildGeminiCuaTranscript(result.events),
        iterationError: result.iterationError,
        status: result.status,
        stopReason:
          result.status === "sdk_error"
            ? result.stopReason || stringifyError(result.iterationError) || undefined
            : result.stopReason,
        usage: {
          reported: result.usageReported,
          inputTokens: result.tokenUsage.input,
          outputTokens: result.tokenUsage.output,
          cachedInputTokens: result.tokenUsage.cached_input,
          reasoningOutputTokens: result.tokenUsage.reasoning,
          totalTokens: result.tokenUsage.total,
        },
        metrics: {
          gemini_cua_turns: metricValue(result.turns),
          gemini_cua_tool_calls: metricValue(result.toolCalls),
        },
      };
    },
    toTrajectory: ({ raw, parsed, finalObservation, status }, taskSpec) =>
      geminiCuaAdapter.fromHarnessResult(
        {
          events: raw.events,
          finalAnswer: parsed.finalAnswer ?? raw.finalMessage,
          status,
          ...(finalObservation && { finalObservation }),
          usage: {
            input_tokens: raw.tokenUsage.input,
            output_tokens: raw.tokenUsage.output,
            cached_input_tokens: raw.tokenUsage.cached_input,
          },
        },
        taskSpec,
      ),
  });
}

function stringifyError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
