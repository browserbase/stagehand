import {
  MASTRACODE_PROTOCOL_VERSION,
  buildMastracodeTranscript,
  parseThinkingLevel,
  runMastracodeSession,
  stringifyError,
  type MastracodeDriverRequest,
  type MastracodeProcessRunner,
  type MastracodeSessionResult,
  type MastracodeThinkingLevel,
  type ResponseUsageSum,
} from "@browserbasehq/stagehand-integrations-mastracode-sdk";
import { sanitizeErrorMessage } from "@browserbasehq/stagehand-integrations/harness";
import type { AvailableModel } from "stagehand-v3";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import { computeListCost } from "./costEstimate.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  resolveFinalAnswer,
  runExternalHarnessTask,
  type ExternalHarnessSessionOutcome,
  type ExternalHarnessToolAdapterLike,
  type ExternalHarnessUsage,
  type MetricValue,
} from "./harnesses/externalRunner.js";
import { mastracodeAdapter } from "./harnesses/mastracodeAdapter.js";
import type { PreparedMastracodeToolAdapter } from "./mastracodeToolAdapter.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import { normalizeUsage } from "./usageNormalization.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export const MASTRACODE_DEFAULT_MODELS: AvailableModel[] = [
  "anthropic/claude-sonnet-4-6" as AvailableModel,
];
export const MASTRACODE_MAX_STEPS_ENV = "EVAL_MASTRACODE_MAX_STEPS";
export const MASTRACODE_THINKING_LEVEL_ENV = "EVAL_MASTRACODE_THINKING_LEVEL";
export const MASTRACODE_TIMEOUT_ENV = "EVAL_MASTRACODE_TIMEOUT_MS";
export const MASTRACODE_ALLOW_UNCACHED_ROUTES_ENV = "EVAL_MASTRACODE_ALLOW_UNCACHED_ROUTES";
export const MASTRACODE_STARTUP_TIMEOUT_ENV = "EVAL_MASTRACODE_STARTUP_TIMEOUT_MS";
export const MASTRACODE_DEFAULT_TIMEOUT_MS = 3_600_000;
export const MASTRACODE_DEFAULT_STARTUP_TIMEOUT_MS = 120_000;
/** Grace between the driver's own wall-clock timeout and the parent's hard kill. */
const HARD_KILL_GRACE_MS = 30_000;

/**
 * Which provider route a model id takes inside mastracode, and whether that
 * route gets prompt caching:
 * - `anthropic_direct`: `anthropic/*` with ANTHROPIC_API_KEY goes through
 *   mastracode's anthropicApiKeyProvider, whose promptCacheMiddleware marks
 *   the last system message and the last message with `cache_control`.
 * - `openai_automatic`: `openai/*` with OPENAI_API_KEY (Responses API);
 *   OpenAI caches prefixes automatically, no breakpoints involved.
 * - `none`: every other provider goes through the models.dev router or the
 *   Mastra gateway, where mastracode places no breakpoints.
 */
export type MastracodeCacheRoute = "anthropic_direct" | "openai_automatic" | "none";

export function toMastracodeModelId(
  model: string,
  env: Record<string, string | undefined> = process.env,
): { modelId: string; cacheRoute: MastracodeCacheRoute } {
  const trimmed = model.trim();
  const modelId = trimmed.startsWith("claude-") ? `anthropic/${trimmed}` : trimmed;
  const provider = modelId.includes("/") ? modelId.slice(0, modelId.indexOf("/")) : "";
  if (provider === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new EvalsError(
        "mastracode anthropic/* models need ANTHROPIC_API_KEY (the direct, cached route); without it mastracode falls back to Claude Max OAuth.",
      );
    }
    return { modelId, cacheRoute: "anthropic_direct" };
  }
  if (provider === "openai") {
    if (!env.OPENAI_API_KEY) {
      throw new EvalsError("mastracode openai/* models need OPENAI_API_KEY.");
    }
    return { modelId, cacheRoute: "openai_automatic" };
  }
  if (
    /^(1|true|yes|on)$/iu.test((env[MASTRACODE_ALLOW_UNCACHED_ROUTES_ENV] ?? "").trim()) &&
    provider
  ) {
    return { modelId, cacheRoute: "none" };
  }
  throw new EvalsError(
    `mastracode supports anthropic/* and openai/* models (received "${model}"): other routes go through the models.dev router or the Mastra gateway, where mastracode places no prompt-cache breakpoints. Set ${MASTRACODE_ALLOW_UNCACHED_ROUTES_ENV}=1 to run them uncached.`,
  );
}

export function readMastracodeMaxSteps(
  dataset: ExternalHarnessTaskPlan["dataset"],
  env: NodeJS.ProcessEnv = process.env,
): number {
  return resolveStepBudget({
    harnessEnvKey: MASTRACODE_MAX_STEPS_ENV,
    dataset,
    harnessDefault: 50,
    env,
  });
}

/** Validate EVAL_MASTRACODE_THINKING_LEVEL; unset keeps mastracode's own default. */
export function readMastracodeThinkingLevel(
  env: Record<string, string | undefined> = process.env,
): MastracodeThinkingLevel | undefined {
  try {
    return parseThinkingLevel(env[MASTRACODE_THINKING_LEVEL_ENV], MASTRACODE_THINKING_LEVEL_ENV);
  } catch (error) {
    throw new EvalsError(stringifyError(error));
  }
}

export function readMastracodeTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env[MASTRACODE_TIMEOUT_ENV] ?? "");
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : MASTRACODE_DEFAULT_TIMEOUT_MS;
}

/** Driver startup budget (mastracode boot, MCP connect + listTools, model switch). */
export function readMastracodeStartupTimeoutMs(
  env: Record<string, string | undefined> = process.env,
): number {
  const parsed = Number(env[MASTRACODE_STARTUP_TIMEOUT_ENV] ?? "");
  return Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : MASTRACODE_DEFAULT_STARTUP_TIMEOUT_MS;
}

export function buildMastracodePrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions,
    resultContract: "structured_output",
  });
}

export interface MastracodeRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedMastracodeToolAdapter;
  signal?: AbortSignal;
  verifier?: ExternalHarnessVerifierConfig;
  /** Test seam: replaces the driver subprocess. */
  runProcess?: MastracodeProcessRunner;
  driverPath?: string;
  env?: NodeJS.ProcessEnv;
}

export async function runMastracodeAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  verifier,
  runProcess,
  driverPath,
  env = process.env,
}: MastracodeRunnerInput): Promise<TaskResult> {
  const { modelId, cacheRoute } = toMastracodeModelId(model, env);
  const stepBudget = readMastracodeMaxSteps(plan.dataset, env);
  const thinkingLevel = readMastracodeThinkingLevel(env);
  const timeoutMs = readMastracodeTimeoutMs(env);
  const startupTimeoutMs = readMastracodeStartupTimeoutMs(env);
  const adapterLike: ExternalHarnessToolAdapterLike = {
    promptInstructions: toolAdapter.promptInstructions,
    captureEvidence: toolAdapter.captureEvidence,
    drainStepObservations: toolAdapter.drainStepObservations,
    observedToolMatcher: toolAdapter.observedToolMatcher,
    browserSessionLoss: toolAdapter.browserSessionLoss,
  };

  return runExternalHarnessTask({
    harness: "mastracode",
    implementation: { name: "mastracode", version: 1 },
    plan,
    model,
    logger,
    toolAdapter: adapterLike,
    verifier,
    resultContract: "structured_output",
    fallbackErrorMessage: "mastracode did not report success",
    stepBudget,
    stepBudgetUnit: "model_steps",
    // The eval policy rides mastracode's hostInstructions (system prompt), so
    // it is cached with the rest of the system block and never in the task.
    systemPromptMode: "native",
    configuration: {
      mastracodeModelId: modelId,
      cacheRoute,
      requestedThinkingLevel: thinkingLevel,
      timeoutMs,
      startupTimeoutMs,
      availableTools: toolAdapter.facadeToolNames,
    },
    runSession: async (prompt, systemPrompt) => {
      const request: MastracodeDriverRequest = {
        version: MASTRACODE_PROTOCOL_VERSION,
        prompt,
        hostInstructions: systemPrompt,
        modelId,
        ...(thinkingLevel && { thinkingLevel }),
        stepBudget,
        timeoutMs,
        startupTimeoutMs,
        mcpServers: toolAdapter.mcpServers,
        facadeToolNames: toolAdapter.facadeToolNames,
        workspaceDir: toolAdapter.paths.workspace,
        appDataDir: toolAdapter.paths.appDataDir,
        homeDir: toolAdapter.paths.home,
      };
      const toolNames = new Map<string, string>();
      const session = await runMastracodeSession({
        request,
        cwd: toolAdapter.paths.workspace,
        env: toolAdapter.env,
        signal,
        runProcess,
        driverPath,
        // The driver's startup deadline and runMC's timeout run back to back.
        killAfterMs: startupTimeoutMs + timeoutMs + HARD_KILL_GRACE_MS,
        onEvent: (event) => {
          if (event.type === "tool_start") toolNames.set(event.toolCallId, event.toolName);
          if (event.type === "tool_end") {
            const name = toolNames.get(event.toolCallId) ?? "";
            if (toolAdapter.observedToolMatcher(name)) toolAdapter.recordObservation?.();
          }
          if (event.type === "violation") {
            logger.warn({
              category: "mastracode",
              level: 0,
              message: `tool isolation violation (${event.kind}): ${event.names.join(", ")}`,
            });
          }
        },
        onStderrLine: (line) => {
          if (!line.trim()) return;
          logger.log({
            category: "mastracode",
            level: 2,
            message: sanitizeErrorMessage(line.slice(0, 2_000)),
          });
        },
      });
      warnOnUsageDrift(session, logger);
      return toSessionOutcome(session, { model, cacheRoute });
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      mastracodeAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          ...(stepObservations?.length && { stepObservations }),
          ...(observedToolName && { observedToolName }),
          finalAnswer: resolveFinalAnswer(parsed, raw.finalText),
          status,
          usage: {
            input_tokens: raw.usage?.promptTokens ?? 0,
            output_tokens: raw.usage?.completionTokens ?? 0,
            ...(raw.usage?.reasoningTokens !== undefined && {
              reasoning_tokens: raw.usage.reasoningTokens,
            }),
            ...(raw.usage?.cachedInputTokens !== undefined && {
              cached_input_tokens: raw.usage.cachedInputTokens,
            }),
          },
        },
        taskSpec,
      ),
  });
}

/** Map a folded driver session onto the shared external-harness outcome. */
export function toSessionOutcome(
  session: MastracodeSessionResult,
  context: { model: string; cacheRoute: MastracodeCacheRoute },
): ExternalHarnessSessionOutcome<MastracodeSessionResult> {
  const agentToolNames = [
    ...new Set(
      session.requests
        .filter((entry) => entry.role === "agent")
        .flatMap((entry) => entry.toolNames),
    ),
  ].sort();
  return {
    raw: session,
    resultText: session.status === "completed" ? session.finalText : "",
    transcriptText: buildMastracodeTranscript(session.events),
    ...(session.iterationError && { iterationError: session.iterationError }),
    status: session.status,
    ...(session.stopReason && { stopReason: session.stopReason }),
    usage: toExternalUsage(session),
    metrics: buildMastracodeMetrics(session, context.model),
    implementation: {
      name: "mastracode",
      version: 1,
      ...(session.ready?.mastracodeVersion && { sdkVersion: session.ready.mastracodeVersion }),
    },
    configuration: {
      ...(session.ready?.codeSdkVersion && { codeSdkVersion: session.ready.codeSdkVersion }),
      ...(session.done?.thinkingLevel && { effectiveThinkingLevel: session.done.thinkingLevel }),
      ...(agentToolNames.length > 0 && { requestTools: agentToolNames }),
      ...(session.responseUsage.side && { sideCallModels: session.responseUsage.side.models }),
      cacheRoute: context.cacheRoute,
    },
  };
}

/**
 * Sum of every model step (`usage_update`). AI SDK v6 reports the whole
 * prompt as input with cache read / write as subsets (openai_cached_subset);
 * a bucket no step reported stays undefined, an observed zero stays 0.
 */
export function toExternalUsage(session: MastracodeSessionResult): ExternalHarnessUsage {
  const usage = session.usage;
  const inputTokens = usage?.promptTokens ?? 0;
  const outputTokens = usage?.completionTokens ?? 0;
  return {
    reported: session.steps > 0,
    inputTokens,
    outputTokens,
    ...(usage?.cachedInputTokens !== undefined && { cachedInputTokens: usage.cachedInputTokens }),
    ...(usage?.cacheCreationInputTokens !== undefined && {
      cacheCreationInputTokens: usage.cacheCreationInputTokens,
    }),
    ...(usage?.reasoningTokens !== undefined && { reasoningOutputTokens: usage.reasoningTokens }),
    totalTokens: inputTokens + outputTokens,
  };
}

export function buildMastracodeMetrics(
  session: MastracodeSessionResult,
  model: string,
): Record<string, MetricValue> {
  const agentRequests = session.requests.filter((entry) => entry.role === "agent");
  const usage = session.usage;
  const metrics: Record<string, MetricValue> = {
    mastracode_steps: metricValue(session.steps),
    mastracode_tool_calls: metricValue(session.toolCalls),
    mastracode_model_requests: metricValue(agentRequests.length),
  };
  if (agentRequests.length > 0) {
    metrics.mastracode_cache_breakpoints_per_request = metricValue(
      agentRequests.reduce((sum, entry) => sum + entry.cacheBreakpoints, 0) / agentRequests.length,
    );
  }
  if (usage && usage.promptTokens > 0 && usage.cachedInputTokens !== undefined) {
    metrics.mastracode_cache_hit_ratio = metricValue(usage.cachedInputTokens / usage.promptTokens);
  }
  const side = session.responseUsage.side;
  if (side) {
    metrics.mastracode_side_requests = metricValue(side.requests);
    metrics.mastracode_side_input_tokens = metricValue(side.inputTokens);
    metrics.mastracode_side_output_tokens = metricValue(side.outputTokens);
    const sideCost = sideCallCost(side, model);
    if (sideCost !== undefined) metrics.mastracode_side_cost_usd = metricValue(sideCost);
  }
  return metrics;
}

/**
 * List-price cost of mastracode's own tool-less calls (thread titles,
 * observational memory). They are not in `usage_update`, so cost_usd does not
 * include them; this prices them from the raw response usage, per call model.
 */
function sideCallCost(side: ResponseUsageSum, model: string): number | undefined {
  if (side.models.length !== 1) return undefined;
  const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : "anthropic";
  const [sideModel] = side.models;
  const normalized = normalizeUsage({
    harness: "mastracode",
    raw: {
      reported: true,
      inputTokens: side.inputTokens,
      cachedInputTokens: side.cachedInputTokens,
      cacheCreationInputTokens: side.cacheCreationInputTokens,
      outputTokens: side.outputTokens,
      totalTokens: side.inputTokens + side.outputTokens,
    },
  });
  return computeListCost(
    normalized,
    sideModel?.includes("/") ? sideModel : `${provider}/${sideModel}`,
  );
}

/** session.getTokenUsage() is mastracode's own tally of the same steps; flag drift. */
function warnOnUsageDrift(session: MastracodeSessionResult, logger: EvalLogger): void {
  const summed = session.usage?.promptTokens ?? 0;
  const reported = session.done?.sessionTokenUsage?.promptTokens;
  if (reported === undefined || summed === 0) return;
  if (Math.abs(reported - summed) / summed > 0.01) {
    logger.warn({
      category: "mastracode",
      level: 1,
      message: `usage drift: Σ step promptTokens=${summed} vs session.getTokenUsage()=${reported}`,
    });
  }
}
