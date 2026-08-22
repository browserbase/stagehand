import {
  buildEveTranscript,
  runEveSession,
  stringifyError,
  toFiniteNumber,
  type EveClientLike,
  type EveTokenUsage,
} from "@browserbasehq/stagehand-integrations-eve-sdk";
import type { AvailableModel } from "stagehand-v3";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedEveToolAdapter } from "./eveToolAdapter.js";
import { writeEveAgentDefinition } from "./eveToolAdapter.js";
import { eveAdapter } from "./harnesses/eveAdapter.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  parseEvalResult,
  runExternalHarnessTask,
  type ExternalHarnessToolAdapterLike,
  type MetricValue,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export interface EveRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedEveToolAdapter;
  signal?: AbortSignal;
  client?: EveClientLike;
  serverUrl?: string;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedEveResult extends ParsedEvalResult {}

export function buildEvePrompt(plan: ExternalHarnessTaskPlan, toolInstructions?: string): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions,
    resultContract: "structured_output",
  });
}

export function parseEveResult(raw: string): ParsedEveResult {
  return parseEvalResult(raw);
}

export async function runEveAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  client,
  serverUrl,
  verifier,
}: EveRunnerInput): Promise<TaskResult> {
  const adapterLike: ExternalHarnessToolAdapterLike | undefined = toolAdapter && {
    promptInstructions: toolAdapter.promptInstructions,
    captureEvidence: toolAdapter.captureEvidence,
    drainStepObservations: toolAdapter.drainStepObservations,
    observedToolMatcher: toolAdapter.observedToolMatcher,
  };
  return runExternalHarnessTask({
    harness: "eve",
    plan,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "structured_output",
    fallbackErrorMessage: "Eve did not report success",
    runSession: async (prompt) => {
      const server = serverUrl
        ? { url: serverUrl }
        : toolAdapter
          ? await prepareGeneratedServer(toolAdapter, model)
          : undefined;
      if (!server) {
        throw new EvalsError(
          "Eve harness needs a prepared tool adapter (generated app) or a serverUrl.",
        );
      }
      const sessionResult = await runEveSession({
        prompt,
        model,
        logger,
        signal,
        server,
        client,
        maxToolSteps: readEveMaxToolSteps(),
        onToolResult: (name) => {
          if (toolAdapter?.observedToolMatcher(name)) toolAdapter.recordObservation?.();
        },
      });
      const usage = normalizeEveUsage(sessionResult.tokenUsage);
      return {
        raw: sessionResult,
        resultText: sessionResult.finalMessage,
        transcriptText: buildEveTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.stopReason ||
          (sessionResult.status === "sdk_error"
            ? stringifyError(sessionResult.iterationError) || undefined
            : undefined),
        usage,
        ...(sessionResult.tokenUsage.costUsd !== undefined && {
          costUsd: sessionResult.tokenUsage.costUsd,
        }),
        metrics: buildEveMetrics(sessionResult.tokenUsage),
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      eveAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: parsed.finalAnswer ?? raw.finalMessage,
          status,
          usage: {
            input_tokens: raw.tokenUsage.inputTokens,
            output_tokens: raw.tokenUsage.outputTokens,
            cached_input_tokens: raw.tokenUsage.cacheReadTokens,
          },
        },
        taskSpec,
      ),
  });
}

async function prepareGeneratedServer(
  toolAdapter: PreparedEveToolAdapter,
  model: AvailableModel,
): Promise<{ appRoot: string; env: Record<string, string>; readyTimeoutMs: number }> {
  await writeEveAgentDefinition(toolAdapter.appRoot, model);
  return {
    appRoot: toolAdapter.appRoot,
    env: stringOnly({ ...process.env, ...toolAdapter.env }),
    readyTimeoutMs: readPositiveIntEnv("EVAL_EVE_READY_TIMEOUT_MS", 120_000),
  };
}

function readEveMaxToolSteps(): number {
  for (const key of ["EVAL_EVE_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 50;
}

function readPositiveIntEnv(key: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function stringOnly(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function normalizeEveUsage(usage: EveTokenUsage) {
  return {
    inputTokens: toFiniteNumber(usage.inputTokens),
    outputTokens: toFiniteNumber(usage.outputTokens),
    cachedInputTokens: toFiniteNumber(usage.cacheReadTokens),
    cacheCreationInputTokens: toFiniteNumber(usage.cacheWriteTokens),
    totalTokens: toFiniteNumber(usage.totalTokens),
  };
}

function buildEveMetrics(usage: EveTokenUsage): Record<string, MetricValue> {
  const normalized = normalizeEveUsage(usage);
  return {
    eve_input_tokens: metricValue(normalized.inputTokens),
    eve_output_tokens: metricValue(normalized.outputTokens),
    eve_cache_read_tokens: metricValue(normalized.cachedInputTokens),
    eve_cache_write_tokens: metricValue(normalized.cacheCreationInputTokens),
    eve_total_tokens: metricValue(normalized.totalTokens),
    ...(usage.costUsd !== undefined && { eve_cost_usd: metricValue(usage.costUsd) }),
  };
}
