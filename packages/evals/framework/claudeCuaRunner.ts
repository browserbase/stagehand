import {
  buildClaudeCuaTranscript,
  runClaudeCuaSession,
  stringifyError,
  type CuaMessagesClient,
  type CuaThinkingConfig,
} from "@browserbasehq/stagehand-integrations-claude-cua-sdk";
import type { AvailableModel } from "stagehand-v3";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { PreparedClaudeCuaToolAdapter } from "./claudeCuaToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { claudeCuaAdapter } from "./harnesses/claudeCuaAdapter.js";
import {
  buildExternalHarnessPrompt,
  metricValue,
  runExternalHarnessTask,
} from "./harnesses/externalRunner.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

/**
 * Models the harness plans when --model is omitted. The planner honors
 * EVAL_CLAUDE_CUA_MODELS (comma separated) over this list, so the allowlist of
 * toolset-capable checkpoints lives in the environment, not in code.
 *
 * `browser_toolset_20260801` is accepted by the Claude 5 family and Opus 4.8
 * (CLAUDE_CUA_CAPABLE_MODELS); the API rejects it with a 400 on Claude 4.6 and
 * older (verified live on claude-sonnet-4-6, 2026-08-31). The default is the
 * cheapest capable model.
 */
export const CLAUDE_CUA_DEFAULT_MODELS: AvailableModel[] = [
  "anthropic/claude-sonnet-5" as AvailableModel,
];

export const CLAUDE_CUA_CAPABLE_MODELS = [
  "claude-opus-4-8",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-fable-5-1",
] as const;

export const CLAUDE_CUA_SYSTEM_PROMPT =
  "You are being evaluated on a browser task. Complete it with the browser tools only and finish by printing the requested EVAL_RESULT line.";

export interface ClaudeCuaRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedClaudeCuaToolAdapter;
  signal?: AbortSignal;
  verifier?: ExternalHarnessVerifierConfig;
  /** Scripted Messages client for tests. */
  client?: CuaMessagesClient;
}

export function buildClaudeCuaPrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({ plan, toolInstructions, resultContract: "marker" });
}

/**
 * The Browser Use toolset is an Anthropic tool surface, so a non-Anthropic
 * provider is rejected. Claude models outside the public allowlist only warn:
 * new checkpoints land faster than this list is updated.
 */
export function assertClaudeCuaModel(model: string, logger?: Pick<EvalLogger, "warn">): void {
  const provider = model.includes("/") ? model.slice(0, model.indexOf("/")) : undefined;
  const bare = provider ? model.slice(provider.length + 1) : model;
  if ((provider !== undefined && provider !== "anthropic") || !bare.startsWith("claude-")) {
    throw new EvalsError(
      `claude_cua runs Anthropic Claude models only (received "${model}"). Set EVAL_CLAUDE_CUA_MODELS or pass -m anthropic/<model>.`,
    );
  }
  if (!(CLAUDE_CUA_CAPABLE_MODELS as readonly string[]).includes(bare)) {
    logger?.warn({
      category: "claude_cua",
      level: 1,
      message: `Model "${model}" is outside the public Browser Use model allowlist (${CLAUDE_CUA_CAPABLE_MODELS.join(", ")}); continuing anyway.`,
    });
  }
}

/**
 * Thinking is on (adaptive) unless EVAL_CLAUDE_CUA_THINKING=off.
 * EVAL_CLAUDE_CUA_THINKING_EFFORT sets output_config.effort;
 * EVAL_CLAUDE_CUA_THINKING_BUDGET switches to budget_tokens for pre-4.6 models.
 */
export function resolveClaudeCuaThinking(env: NodeJS.ProcessEnv = process.env): CuaThinkingConfig {
  if ((env.EVAL_CLAUDE_CUA_THINKING ?? "").trim().toLowerCase() === "off") {
    return { type: "disabled" };
  }
  const budget = Number.parseInt(env.EVAL_CLAUDE_CUA_THINKING_BUDGET ?? "", 10);
  if (Number.isFinite(budget) && budget > 0) return { type: "enabled", budgetTokens: budget };
  const effort = (env.EVAL_CLAUDE_CUA_THINKING_EFFORT ?? "").trim().toLowerCase();
  const efforts = ["low", "medium", "high", "xhigh", "max"] as const;
  return {
    type: "adaptive",
    effort: (efforts as readonly string[]).includes(effort)
      ? (effort as (typeof efforts)[number])
      : "xhigh",
  };
}

export async function runClaudeCuaAgent(input: ClaudeCuaRunnerInput): Promise<TaskResult> {
  const { plan, model, logger, toolAdapter, signal, verifier, client } = input;
  assertClaudeCuaModel(model, logger);
  // One turn is one API round trip and may hold several tool members; the
  // shared tool-step budget is a mild over-allowance, as for claude_code / pi.
  const maxTurns = resolveStepBudget({
    harnessEnvKey: "EVAL_CLAUDE_CUA_MAX_TURNS",
    dataset: plan.dataset,
    harnessDefault: 50,
  });
  const thinking = resolveClaudeCuaThinking();
  return runExternalHarnessTask({
    harness: "claude_cua",
    plan,
    model,
    logger,
    toolAdapter,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "claude_cua did not report success",
    stepBudget: maxTurns,
    stepBudgetUnit: "turns",
    configuration: {
      requestedThinking: thinking,
      ...(thinking.type === "adaptive" && { requestedReasoningEffort: thinking.effort }),
    },
    systemPromptMode: "native",
    runSession: async (prompt, systemPrompt) => {
      const sessionResult = await runClaudeCuaSession({
        prompt,
        model,
        logger,
        signal,
        maxTurns,
        tools: toolAdapter.executor,
        systemPrompt: `${systemPrompt}\n\n${CLAUDE_CUA_SYSTEM_PROMPT}`,
        thinking,
        ...(client && { client }),
      });
      const usage = sessionResult.tokenUsage;
      return {
        raw: sessionResult,
        resultText: sessionResult.finalMessage,
        transcriptText: buildClaudeCuaTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.status === "sdk_error"
            ? sessionResult.stopReason || stringifyError(sessionResult.iterationError) || undefined
            : sessionResult.stopReason,
        // Anthropic shape: input excludes cache reads/writes (anthropic_cache_separate).
        usage: {
          reported: sessionResult.usageReported,
          inputTokens: usage.input,
          outputTokens: usage.output,
          cachedInputTokens: usage.cache_read,
          cacheCreationInputTokens: usage.cache_creation,
          totalTokens: usage.total,
        },
        metrics: {
          claude_cua_turns: metricValue(sessionResult.turns),
          claude_cua_tool_calls: metricValue(sessionResult.toolCalls),
        },
      };
    },
    toTrajectory: ({ raw, parsed, finalObservation, status }, taskSpec) =>
      claudeCuaAdapter.fromHarnessResult(
        {
          events: raw.events,
          ...(finalObservation && { finalObservation }),
          stepObservations: toolAdapter.drainObservationsByToolUse(),
          finalAnswer: parsed.finalAnswer ?? raw.finalMessage,
          status,
          usage: {
            input_tokens: raw.tokenUsage.input,
            output_tokens: raw.tokenUsage.output,
            cached_input_tokens: raw.tokenUsage.cache_read,
          },
        },
        taskSpec,
      ),
  });
}
