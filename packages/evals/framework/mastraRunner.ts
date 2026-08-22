import {
  buildMastraTranscript,
  loadMastraSdk,
  runMastraSession,
  stringifyError,
  toFiniteNumber,
  type MastraSdk,
  type MastraSessionResult,
  type MastraTokenUsage,
} from "@browserbasehq/stagehand-integrations-mastra-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import {
  buildExternalHarnessPrompt,
  parseEvalResult,
  runExternalHarnessTask,
  type ExternalHarnessSessionOutcome,
  type ExternalHarnessToolAdapterLike,
  type ExternalHarnessUsage,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import { mastraAdapter } from "./harnesses/mastraAdapter.js";
import type { PreparedMastraToolAdapter } from "./mastraToolAdapter.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { MastraSdk } from "@browserbasehq/stagehand-integrations-mastra-sdk";
export {
  buildMastraTranscript,
  loadMastraSdk,
  normalizeMastraModel,
  runMastraSession,
} from "@browserbasehq/stagehand-integrations-mastra-sdk";
export { EVAL_RESULT_SCHEMA } from "./harnesses/externalRunner.js";

export interface MastraRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedMastraToolAdapter;
  signal?: AbortSignal;
  sdk?: MastraSdk;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedMastraResult extends ParsedEvalResult {}

export function buildMastraPrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions,
    resultContract: "structured_output",
  });
}

export function parseMastraResult(raw: string): ParsedMastraResult {
  return parseEvalResult(raw);
}

export async function runMastraAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  sdk,
  verifier,
}: MastraRunnerInput): Promise<TaskResult> {
  const adapterLike: ExternalHarnessToolAdapterLike | undefined = toolAdapter && {
    promptInstructions: toolAdapter.promptInstructions,
    captureEvidence: toolAdapter.captureEvidence,
    drainStepObservations: toolAdapter.drainStepObservations,
    observedToolMatcher: toolAdapter.observedToolMatcher,
  };
  const result = await runExternalHarnessTask({
    harness: "mastra",
    plan,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "structured_output",
    fallbackErrorMessage: "Mastra did not report success",
    runSession: async (prompt): Promise<ExternalHarnessSessionOutcome<MastraSessionResult>> => {
      const sessionResult = await runMastraSession({
        prompt,
        model,
        logger,
        sdk: sdk ?? (await loadMastraSdk()),
        signal,
        session: {
          maxSteps: readMastraMaxSteps(),
          mcpServers: toolAdapter?.mcpServers,
          tools: toolAdapter?.tools,
          mcpTimeoutMs: readPositiveIntEnv("EVAL_MASTRA_MCP_TIMEOUT_MS"),
        },
        onToolResult: toolAdapter?.onToolResult,
      });
      return {
        raw: sessionResult,
        resultText: sessionResult.status === "sdk_error" ? "" : sessionResult.finalText,
        transcriptText: buildMastraTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.stopReason ||
          (sessionResult.status === "sdk_error"
            ? stringifyError(sessionResult.iterationError) || undefined
            : undefined),
        usage: normalizeMastraUsage(sessionResult.tokenUsage),
        metrics: {},
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      mastraAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: parsed.finalAnswer ?? raw.finalText,
          status,
          usage: {
            input_tokens: raw.tokenUsage.inputTokens,
            output_tokens: raw.tokenUsage.outputTokens,
            reasoning_tokens: raw.tokenUsage.reasoningTokens,
            cached_input_tokens: raw.tokenUsage.cachedInputTokens,
          },
        },
        taskSpec,
      ),
  });
  if (!verifier && result.harnessStatus === "sdk_error" && result._success === true) {
    return {
      ...result,
      _success: false,
      error: result.harnessStopReason ?? "Mastra did not report success",
    };
  }
  return result;
}

function readMastraMaxSteps(): number {
  for (const key of ["EVAL_MASTRA_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const value = readPositiveIntEnv(key);
    if (value) return value;
  }
  return 50;
}

function readPositiveIntEnv(key: string): number | undefined {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function normalizeMastraUsage(usage: MastraTokenUsage): ExternalHarnessUsage {
  const inputTokens = toFiniteNumber(usage.inputTokens);
  const outputTokens = toFiniteNumber(usage.outputTokens);
  return {
    inputTokens,
    outputTokens,
    cachedInputTokens: toFiniteNumber(usage.cachedInputTokens),
    reasoningOutputTokens: toFiniteNumber(usage.reasoningTokens),
    totalTokens: inputTokens + outputTokens,
  };
}
