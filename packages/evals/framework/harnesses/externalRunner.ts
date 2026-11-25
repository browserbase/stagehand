import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { HarnessTrajectory, TerminationReason } from "./trajectoryAdapter.js";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import type { BrowserSessionLoss } from "../../core/contracts/tool.js";
import type { EvalLogger } from "../../logger.js";
import { EVAL_SYSTEM_PROMPT } from "../evalSystemPrompt.js";
import { datasetPromptGuidance } from "../externalHarnessPlan.js";
import type { ExternalHarnessTaskPlan } from "../externalHarnessPlan.js";
import type { StepObservation } from "../observationRecorder.js";
import type { TaskResult } from "../types.js";
import { gradeExternalTrajectory, type ExternalHarnessVerifierConfig } from "../verifierAdapter.js";
import { emitTrajectoryTrace } from "./traceLog.js";
import { resolveBilledCost, type BilledCost } from "../costEstimate.js";
import { normalizeUsage, type NormalizedUsage } from "../usageNormalization.js";

export type MetricValue = { count: number; value: number };

export function metricValue(value: unknown): MetricValue {
  return { count: 1, value: toFiniteNumber(value) };
}

export type EvalResultContract = "marker" | "structured_output";

export const RESULT_CONTRACT_ENV = "EVAL_RESULT_CONTRACT";

export function readResultContract(
  harnessDefault: EvalResultContract,
  env: NodeJS.ProcessEnv = process.env,
): EvalResultContract {
  const value = env[RESULT_CONTRACT_ENV]?.trim();
  if (!value) return harnessDefault;
  if (value === "structured_output") return value;
  throw new Error(`${RESULT_CONTRACT_ENV} must be unset or "structured_output" (got "${value}").`);
}

export function requestedResult(resultContract: EvalResultContract): string {
  return resultContract === "marker"
    ? "the requested EVAL_RESULT line"
    : "the requested JSON report";
}

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

export function parseEvalResult(raw: string): ParsedEvalResult {
  const markerPattern = /^\s*(?:\*\*)?EVAL_RESULT:/gmu;
  const markerMatches = [...raw.matchAll(markerPattern)];
  const markerMatch = markerMatches.at(-1);
  const markerIndex = markerMatch?.index ?? -1;
  const resultText =
    markerIndex >= 0 ? raw.slice(markerIndex + (markerMatch?.[0].length ?? 0)).trim() : raw.trim();
  const candidates =
    markerIndex >= 0
      ? [resultText, resultText.split(/\r?\n/, 1)[0]?.trim(), extractFirstJsonObject(resultText)]
      : [resultText, resultText.split(/\r?\n/, 1)[0]?.trim(), trailingEvalResultJson(resultText)];

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = tryParseEvalJson(candidate);
    if (parsed) return { ...parsed, raw };
  }
  return { success: false, raw };
}

export function resolveFinalAnswer(
  parsed: Pick<ParsedEvalResult, "finalAnswer">,
  lastMessage: string | undefined,
): string | undefined {
  if (parsed.finalAnswer !== undefined) return parsed.finalAnswer;
  if (!lastMessage) return undefined;
  const stripped = stripEmbeddedEvalReports(lastMessage).trim();
  return stripped || undefined;
}

export function stripEmbeddedEvalReports(text: string): string {
  let output = text;
  for (const span of extractJsonObjects(text)) {
    if (isEvalResultJson(span)) output = output.replace(span, "");
  }
  output = output.replace(/^[ \t]*(?:\*\*)?EVAL_RESULT:[ \t]*(?:\*\*)?[ \t]*$/gmu, "");
  output = output.replace(/^[ \t]*```[\w-]+[ \t]*\n\s*```[ \t]*$/gmu, "");
  return output.replace(/\n{3,}/gu, "\n\n");
}

export interface ExternalHarnessPromptInput {
  plan: ExternalHarnessTaskPlan;
  toolInstructions?: string;
  resultContract: EvalResultContract;
}

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

export interface ExternalHarnessUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
  cacheCreationInputTokens?: number;
  reasoningOutputTokens?: number;
  totalTokens: number;
  reported?: boolean;
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
  browserSessionLoss?: () => BrowserSessionLoss | undefined;
}

export const BROWSER_SESSION_LOST_STOP_REASON = "browser_session_lost";

export function deriveTerminationReason(
  outcome: Pick<ExternalHarnessSessionOutcome<unknown>, "status" | "stopReason">,
): TerminationReason {
  if (outcome.status === "completed") return "completed";
  if (outcome.status === "max_turns") return "step_budget";
  const stopReason = outcome.stopReason ?? "";
  if (stopReason === BROWSER_SESSION_LOST_STOP_REASON) return "browser_session_lost";
  if (/\b(aborted|interrupted)\b/iu.test(stopReason)) return "aborted";
  return "sdk_error";
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
  implementation?: { name: string; version: number; sdkVersion?: string };
  plan: ExternalHarnessTaskPlan;
  model?: string;
  logger: EvalLogger;
  toolAdapter?: ExternalHarnessToolAdapterLike;
  verifier?: ExternalHarnessVerifierConfig;
  resultContract: EvalResultContract;
  fallbackErrorMessage: string;
  stepBudget?: number;
  stepBudgetUnit?: "tool_calls" | "successful_tool_calls" | "model_steps" | "agent_steps" | "turns";
  configuration?: Record<string, unknown>;
  parseResult?: (raw: string) => ParsedEvalResult;
  systemPromptMode?: "native" | "task_prefix";
  runSession: (
    prompt: string,
    systemPrompt: string,
  ) => Promise<ExternalHarnessSessionOutcome<TRaw>>;
  toTrajectory: (input: ExternalHarnessTrajectoryInput<TRaw>, taskSpec: TaskSpec) => Trajectory;
}

export async function runExternalHarnessTask<TRaw>({
  harness,
  implementation,
  plan,
  model,
  logger,
  toolAdapter,
  verifier,
  resultContract,
  fallbackErrorMessage,
  stepBudget,
  stepBudgetUnit,
  configuration,
  parseResult,
  systemPromptMode = "task_prefix",
  runSession,
  toTrajectory,
}: RunExternalHarnessTaskInput<TRaw>): Promise<TaskResult> {
  const prompt = buildExternalHarnessPrompt({
    plan,
    toolInstructions: toolAdapter?.promptInstructions,
    resultContract,
  });
  const harnessConfiguration = {
    ...configuration,
    evalPolicyVersion: 1,
    systemPromptMode,
    ...(resultContract === "structured_output" && { resultContract }),
    ...(stepBudget !== undefined && { stepBudget }),
    ...(stepBudgetUnit && { stepBudgetUnit }),
  };
  const startedAt = performance.now();
  const sessionOutcome = await runSession(
    systemPromptMode === "native" ? prompt : `${EVAL_SYSTEM_PROMPT}\n\n${prompt}`,
    systemPromptMode === "native" ? EVAL_SYSTEM_PROMPT : "",
  );
  const agentWallMs = performance.now() - startedAt;
  const browserSessionLoss = toolAdapter?.browserSessionLoss?.();
  if (browserSessionLoss) {
    logger.warn({
      category: "stagehand_facade",
      level: 1,
      message: `browser session lost before the agent finished: ${browserSessionLoss.cause}`,
    });
  }
  const outcome: ExternalHarnessSessionOutcome<TRaw> = browserSessionLoss
    ? {
        ...sessionOutcome,
        status: "sdk_error",
        stopReason: BROWSER_SESSION_LOST_STOP_REASON,
        iterationError: `Browser session lost (${browserSessionLoss.cause})`,
      }
    : sessionOutcome;
  const iterationErrorMessage = stringifyError(outcome.iterationError);
  const rawResult = [outcome.resultText, outcome.transcriptText, iterationErrorMessage]
    .filter(Boolean)
    .join("\n\n");
  const trustedResultText = outcome.resultText.trim();
  const parsed = { ...(parseResult ?? parseEvalResult)(trustedResultText), raw: rawResult };
  parsed.finalAnswer = resolveFinalAnswer(parsed, trustedResultText);
  const sanitizedStopReason = outcome.stopReason
    ? sanitizeErrorMessage(outcome.stopReason)
    : undefined;
  const sanitizedIterationError = iterationErrorMessage
    ? sanitizeErrorMessage(iterationErrorMessage)
    : undefined;
  const sdkErrorMessage = browserSessionLoss
    ? sanitizedIterationError
    : (sanitizedStopReason ?? sanitizedIterationError);
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
  const terminationReason = deriveTerminationReason(outcome);
  const usage = normalizeUsage({ harness, raw: outcome.usage });
  const cost = resolveBilledCost({ harness, model, usage, reportedCostUsd: outcome.costUsd });
  if (cost.cost_source === "unavailable" && usage.convention !== "unreported") {
    logger.log({
      category: "cost",
      level: 1,
      message: `cost unavailable for ${harness} on ${model ?? "(unknown model)"} (channel ${cost.billing_channel}); cost_usd omitted`,
    });
  }
  const baseMetrics: Record<string, MetricValue> = {
    ...buildNormalizedHarnessMetrics(outcome),
    ...buildUsageCostMetrics(usage, cost),
    ...(stepBudget !== undefined && { step_budget: metricValue(stepBudget) }),
    agent_wall_ms: metricValue(agentWallMs),
  };
  const baseResult: TaskResult = {
    _success: outcome.status === "sdk_error" ? false : parsed.success,
    error: outcome.status === "sdk_error" || !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    harnessStatus: outcome.status,
    harnessConfiguration,
    usageConvention: usage.convention,
    ...(implementation && { harnessImplementation: implementation }),
    ...(sanitizedStopReason && { harnessStopReason: sanitizedStopReason }),
    terminationReason,
    agent_wall_ms: Math.round(agentWallMs),
    cost_source: cost.cost_source,
    billing_channel: cost.billing_channel,
    ...(cost.cost_pricing && { cost_pricing: cost.cost_pricing }),
    ...(cost.cost_usd !== undefined && { cost_usd: cost.cost_usd }),
    [`${prefix}Status`]: outcome.status,
    ...(sanitizedStopReason && { [`${prefix}StopReason`]: sanitizedStopReason }),
    logs: logger.getLogs(),
    metrics: baseMetrics,
  };
  if (!verifier) {
    return { ...baseResult, metrics: { ...baseMetrics, total_wall_ms: metricValue(agentWallMs) } };
  }

  const isFacadeTool = toolAdapter?.observedToolMatcher;
  const evidenceTimeoutMs = readPositiveIntEnv("EVAL_CAPTURE_EVIDENCE_TIMEOUT_MS", 15_000);
  const evidenceStartedAt = performance.now();
  const finalObservation = toolAdapter?.captureEvidence
    ? await bestEffort(toolAdapter.captureEvidence(), evidenceTimeoutMs)
    : undefined;
  const stepObservations = toolAdapter?.drainStepObservations
    ? await bestEffort(toolAdapter.drainStepObservations(), evidenceTimeoutMs)
    : undefined;
  const evidenceMs = performance.now() - evidenceStartedAt;
  let trajectory: HarnessTrajectory | undefined;
  const verifierStartedAt = performance.now();
  const gradedResult = await gradeExternalTrajectory({
    buildTrajectory: () => {
      trajectory = withTerminationReason(
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
        terminationReason,
      );
      if (implementation) trajectory.harnessImplementation = implementation;
      trajectory.harnessConfiguration = harnessConfiguration;
      if (cost.cost_pricing) trajectory.cost_pricing = cost.cost_pricing;
      try {
        emitTrajectoryTrace(logger, {
          trajectory,
          outcome: { ...outcome, stopReason: sanitizedStopReason },
          usage,
          agentWallMs,
          isFacadeTool,
          report: {
            summary: parsed.summary,
            finalAnswer: parsed.finalAnswer,
            success: parsed.success,
          },
        });
      } catch (traceError) {
        logger.warn({
          category: "trace",
          level: 1,
          message: `step trace failed: ${stringifyError(traceError)}`,
        });
      }
      return trajectory;
    },
    verifier,
    baseResult,
    errorMessage,
    category: harness,
    logger,
    isFacadeTool,
  });
  const verifierWallMs = performance.now() - verifierStartedAt;
  const timing = buildTimingMetrics({ agentWallMs, evidenceMs, verifierWallMs });
  logger.log({
    category: "trace",
    level: 1,
    message: [
      "timing",
      `agent=${formatSeconds(agentWallMs)}`,
      `evidence=${formatSeconds(evidenceMs)}`,
      `verifier=${formatSeconds(verifierWallMs)}`,
      `total=${formatSeconds(timing.total_wall_ms.value)}`,
      ...(cost.cost_usd !== undefined ? [`cost=$${cost.cost_usd} (${cost.cost_source})`] : []),
    ].join(" · "),
  });
  const facadeMetrics =
    trajectory && isFacadeTool ? buildFacadeToolCallMetrics(trajectory, isFacadeTool) : {};
  const gradedMetrics = (gradedResult.metrics ?? {}) as Record<string, MetricValue>;
  const result: TaskResult = {
    ...gradedResult,
    metrics: { ...gradedMetrics, ...facadeMetrics, ...timing },
    logs: logger.getLogs(),
  };
  return result;
}

function withTerminationReason(
  trajectory: Trajectory,
  terminationReason: TerminationReason,
): HarnessTrajectory {
  return { ...trajectory, terminationReason };
}

export function buildFacadeToolCallMetrics(
  trajectory: Pick<Trajectory, "steps">,
  isFacadeTool: (name: string) => boolean,
): Record<string, MetricValue> {
  let calls = 0;
  let failures = 0;
  for (const step of trajectory.steps) {
    if (!isFacadeTool(step.actionName)) continue;
    calls += 1;
    if (step.toolOutput?.ok !== false) continue;
    failures += 1;
  }
  return {
    facade_tool_calls: metricValue(calls),
    facade_tool_call_failures: metricValue(failures),
  };
}

export function buildTimingMetrics(timing: {
  agentWallMs: number;
  evidenceMs: number;
  verifierWallMs: number;
}): Record<"agent_wall_ms" | "evidence_ms" | "verifier_wall_ms" | "total_wall_ms", MetricValue> {
  return {
    agent_wall_ms: metricValue(timing.agentWallMs),
    evidence_ms: metricValue(timing.evidenceMs),
    verifier_wall_ms: metricValue(timing.verifierWallMs),
    total_wall_ms: metricValue(timing.agentWallMs + timing.evidenceMs + timing.verifierWallMs),
  };
}

export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function buildUsageCostMetrics(
  usage: NormalizedUsage,
  cost: BilledCost,
): Record<string, MetricValue> {
  return {
    ...(usage.convention !== "unreported" && {
      usage_input_total: metricValue(usage.input_total),
      usage_input_cached: metricValue(usage.input_cached),
      usage_output: metricValue(usage.output),
      usage_reasoning: metricValue(usage.reasoning),
    }),
    ...(cost.cost_usd !== undefined && { cost_usd: metricValue(cost.cost_usd) }),
  };
}

export function legacyHarnessFieldPrefix(harness: string): string {
  return harness.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

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
  return extractJsonObjects(value)[0];
}

function extractJsonObjects(value: string): string[] {
  const spans: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (start < 0) {
      if (character === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
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
      if (depth === 0) {
        spans.push(value.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return spans;
}

function trailingEvalResultJson(text: string): string | undefined {
  // Models commonly wrap the report in a Markdown fence ("```json\n{...}\n```");
  // the closing fence must not stop the report from counting as trailing.
  const unfenced = text.replace(/\s*```\s*$/u, "");
  const last = extractJsonObjects(unfenced).at(-1);
  return last && unfenced.endsWith(last) && isEvalResultJson(last) ? last : undefined;
}

function isEvalResultJson(candidate: string): boolean {
  try {
    const parsed: unknown = JSON.parse(candidate);
    return (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { success?: unknown }).success === "boolean" &&
      (typeof (parsed as { summary?: unknown }).summary === "string" ||
        typeof (parsed as { finalAnswer?: unknown }).finalAnswer === "string") &&
      Object.keys(parsed).every((key) => ["success", "summary", "finalAnswer"].includes(key))
    );
  } catch {
    return false;
  }
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
