import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import type { EvalLogger } from "../../logger.js";
import { datasetPromptGuidance } from "../externalHarnessPlan.js";
import type { ExternalHarnessTaskPlan } from "../externalHarnessPlan.js";
import type { StepObservation } from "../observationRecorder.js";
import type { TaskResult } from "../types.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "../verifierAdapter.js";

export type MetricValue = { count: number; value: number };

export function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFiniteNumber(value) };
}

/** How an external harness asks the agent to report its result. */
export type EvalResultContract = "marker" | "structured_output";

/** Shared output schema used by harnesses that enforce structured output. */
export const EVAL_RESULT_SCHEMA = {
  type: "object",
  properties: {
    success: { type: "boolean" },
    summary: { type: "string" },
    finalAnswer: { type: "string" },
  },
  required: ["success", "summary", "finalAnswer"],
  additionalProperties: false,
} as const;

export interface ParsedEvalResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

/** Parse either supported external-harness self-report format. */
export function parseEvalResult(raw: string): ParsedEvalResult {
  // Intentionally accept both report shapes for every external harness so
  // marker and structured-output runners share the same resilient parser.
  const markerPattern = /^\s*(?:\*\*)?EVAL_RESULT:/gmu;
  const markerMatches = [...raw.matchAll(markerPattern)];
  const markerMatch = markerMatches.at(-1);
  const markerIndex = markerMatch?.index ?? -1;
  const resultText =
    markerIndex >= 0 ? raw.slice(markerIndex + (markerMatch?.[0].length ?? 0)).trim() : raw.trim();
  const candidates =
    markerIndex >= 0
      ? [resultText, resultText.split(/\r?\n/, 1)[0]?.trim(), extractFirstJsonObject(resultText)]
      : [resultText, resultText.split(/\r?\n/, 1)[0]?.trim()];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = tryParseEvalJson(candidate);
    if (parsed) return { ...parsed, raw };
  }
  return { success: false, raw };
}

export interface ExternalHarnessPromptInput {
  plan: ExternalHarnessTaskPlan;
  toolInstructions?: string;
  resultContract: EvalResultContract;
}

/** Build the stable prompt shared by external harness SDK runners. */
export function buildExternalHarnessPrompt({
  plan,
  toolInstructions,
  resultContract,
}: ExternalHarnessPromptInput): string {
  const contractTail =
    resultContract === "marker"
      ? [
          "At the end, print exactly one line beginning with EVAL_RESULT: followed by compact JSON.",
          'The JSON schema is: {"success": boolean, "summary": string, "finalAnswer": string}.',
        ]
      : [
          "Do not edit repository files.",
          "At the end, return compact JSON matching this schema:",
          '{"success": boolean, "summary": string, "finalAnswer": string}',
        ];
  return [
    "You are running a browser benchmark task.",
    "",
    `Dataset: ${plan.dataset}`,
    plan.taskId ? `Task ID: ${plan.taskId}` : undefined,
    `Start URL: ${plan.startUrl}`,
    "",
    "Instruction:",
    plan.instruction,
    "",
    datasetPromptGuidance(plan.dataset),
    toolInstructions ?? "Use the available browser/web tools to complete the task.",
    ...contractTail,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Normalized token usage reported by an external harness SDK. */
export interface ExternalHarnessUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens: number;
}

export interface ExternalHarnessSessionOutcome<TRaw> {
  raw: TRaw;
  resultText: string;
  transcriptText: string;
  iterationError?: unknown;
  status: string;
  stopReason?: string;
  usage: ExternalHarnessUsage;
  costUsd?: number;
  metrics: Record<string, MetricValue>;
}

export interface ExternalHarnessToolAdapterLike {
  promptInstructions?: string;
  captureEvidence?: () => Promise<ProbeEvidence>;
  drainStepObservations?: () => Promise<StepObservation[]>;
  observedToolMatcher?: (name: string) => boolean;
}

export interface ExternalHarnessTrajectoryInput<TRaw> {
  raw: TRaw;
  parsed: ParsedEvalResult;
  outcome: ExternalHarnessSessionOutcome<TRaw>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
  status: Trajectory["status"];
}

export interface RunExternalHarnessTaskInput<TRaw> {
  harness: string;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
  toolAdapter?: ExternalHarnessToolAdapterLike;
  verifier?: ExternalHarnessVerifierConfig;
  resultContract: EvalResultContract;
  fallbackErrorMessage: string;
  /** Harness-specific result parser; defaults to the strict parseEvalResult. */
  parseResult?: (raw: string) => ParsedEvalResult;
  runSession: (prompt: string) => Promise<ExternalHarnessSessionOutcome<TRaw>>;
  toTrajectory: (input: ExternalHarnessTrajectoryInput<TRaw>, taskSpec: TaskSpec) => Trajectory;
}

/**
 * Run the harness-agnostic lifecycle around one external SDK session. Evidence
 * capture is bounded because terminal probes are best-effort and must never
 * leave an otherwise completed benchmark hanging indefinitely.
 */
export async function runExternalHarnessTask<TRaw>({
  harness,
  plan,
  logger,
  toolAdapter,
  verifier,
  resultContract,
  fallbackErrorMessage,
  parseResult,
  runSession,
  toTrajectory,
}: RunExternalHarnessTaskInput<TRaw>): Promise<TaskResult> {
  const prompt = buildExternalHarnessPrompt({
    plan,
    toolInstructions: toolAdapter?.promptInstructions,
    resultContract,
  });
  const outcome = await runSession(prompt);
  const iterationErrorMessage = stringifyError(outcome.iterationError);
  const rawResult = [outcome.resultText, outcome.transcriptText, iterationErrorMessage]
    .filter(Boolean)
    .join("\n\n");
  const trustedResultText = outcome.resultText.trim();
  const parsed = { ...(parseResult ?? parseEvalResult)(trustedResultText), raw: rawResult };
  const sanitizedStopReason = outcome.stopReason
    ? sanitizeErrorMessage(outcome.stopReason)
    : undefined;
  const sanitizedIterationError = iterationErrorMessage
    ? sanitizeErrorMessage(iterationErrorMessage)
    : undefined;
  const sdkErrorMessage = sanitizedStopReason ?? sanitizedIterationError;
  const errorMessage = sanitizeErrorMessage(
    outcome.status === "sdk_error"
      ? (sdkErrorMessage ?? fallbackErrorMessage)
      : parsed.summary ||
          sanitizedStopReason ||
          sanitizedIterationError ||
          outcome.resultText ||
          outcome.transcriptText ||
          fallbackErrorMessage,
  );
  const prefix = legacyHarnessFieldPrefix(harness);
  const baseResult: TaskResult = {
    _success: outcome.status === "sdk_error" ? false : parsed.success,
    error: outcome.status === "sdk_error" || !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    harnessStatus: outcome.status,
    ...(sanitizedStopReason && { harnessStopReason: sanitizedStopReason }),
    // Deprecated compatibility aliases; consumers should use the normalized
    // harnessStatus / harnessStopReason fields for newly registered harnesses.
    [`${prefix}Status`]: outcome.status,
    ...(sanitizedStopReason && { [`${prefix}StopReason`]: sanitizedStopReason }),
    logs: logger.getLogs(),
    metrics: buildNormalizedHarnessMetrics(outcome),
  };
  if (!verifier) return baseResult;

  const evidenceTimeoutMs = readPositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000);
  const finalObservation = toolAdapter?.captureEvidence
    ? await bestEffort(toolAdapter.captureEvidence(), evidenceTimeoutMs)
    : undefined;
  const stepObservations = toolAdapter?.drainStepObservations
    ? await bestEffort(toolAdapter.drainStepObservations(), evidenceTimeoutMs)
    : undefined;
  const gradedResult = await gradeExternalTrajectory({
    buildTrajectory: () =>
      toTrajectory(
        {
          raw: outcome.raw,
          parsed,
          outcome,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(toolAdapter?.observedToolMatcher && {
            observedToolName: toolAdapter.observedToolMatcher,
          }),
          status: outcome.status === "completed" ? "complete" : "error",
        },
        verifier.taskSpec,
      ),
    verifier,
    baseResult,
    errorMessage,
    category: harness,
    logger,
  });
  return outcome.status === "sdk_error"
    ? { ...gradedResult, _success: false, error: errorMessage }
    : gradedResult;
}

/** Convert a registered harness id to its deprecated TaskResult field prefix. */
export function legacyHarnessFieldPrefix(harness: string): string {
  return harness.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

/** Add portable external-harness metrics without replacing native metrics. */
export function buildNormalizedHarnessMetrics(
  outcome: Pick<ExternalHarnessSessionOutcome<unknown>, "usage" | "costUsd" | "metrics">,
): Record<string, MetricValue> {
  return {
    ...outcome.metrics,
    harness_input_tokens: metricValue(outcome.usage.inputTokens),
    harness_output_tokens: metricValue(outcome.usage.outputTokens),
    harness_total_tokens: metricValue(outcome.usage.totalTokens),
    ...(outcome.usage.cachedInputTokens !== undefined && {
      harness_cached_input_tokens: metricValue(outcome.usage.cachedInputTokens),
    }),
    ...(outcome.usage.cacheCreationInputTokens !== undefined && {
      harness_cache_creation_input_tokens: metricValue(outcome.usage.cacheCreationInputTokens),
    }),
    ...(outcome.usage.reasoningOutputTokens !== undefined && {
      harness_reasoning_output_tokens: metricValue(outcome.usage.reasoningOutputTokens),
    }),
    ...(outcome.costUsd !== undefined && {
      harness_cost_usd: metricValue(outcome.costUsd),
    }),
  };
}

function toFiniteNumber(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim()
        ? Number(value)
        : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractFirstJsonObject(value: string): string | undefined {
  const start = value.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return value.slice(start, index + 1);
    }
  }
  return undefined;
}

function tryParseEvalJson(candidate: string): Omit<ParsedEvalResult, "raw"> | undefined {
  try {
    const parsed = JSON.parse(candidate) as {
      success?: unknown;
      summary?: unknown;
      finalAnswer?: unknown;
    };
    return {
      success: parsed.success === true,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      finalAnswer: typeof parsed.finalAnswer === "string" ? parsed.finalAnswer : undefined,
    };
  } catch {
    return undefined;
  }
}

/** Matches the integration packages while avoiding a runner-specific dependency. */
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

function readPositiveIntEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`external harness operation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function bestEffort<T>(promise: Promise<T>, timeoutMs: number): Promise<T | undefined> {
  return withTimeout(promise, timeoutMs).catch((): undefined => undefined);
}
