/**
 * Antigravity harness: eval glue around the session adapter in
 * `@browserbasehq/stagehand-integrations-antigravity`. The runner speaks the
 * Deep Agents event protocol, so it shares that harness's MCP tool mount and
 * trajectory adapter. Antigravity keeps its native system prompt; the eval
 * policy is appended as a section.
 */
import {
  ANTIGRAVITY_DEFAULT_MODEL,
  ANTIGRAVITY_FACADE_SYSTEM_PROMPT,
  buildAntigravityTranscript,
  readAntigravitySdkVersion,
  readAntigravityThinkingLevel,
  resolveAntigravityRunnerDir,
  runAntigravitySession,
  stringifyError,
  toFiniteNumber,
  type AntigravityProcessSpawner,
  type AntigravityTokenUsage,
} from "@browserbasehq/stagehand-integrations-antigravity";
import type { AvailableModel } from "stagehand-v3";
import type { ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import {
  prepareDeepagentsToolAdapter,
  type DeepagentsToolAdapterInput,
  type PreparedDeepagentsToolAdapter,
} from "./deepagentsToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { deepagentsAdapter } from "./harnesses/deepagentsAdapter.js";
import {
  readResultContract,
  runExternalHarnessTask,
  type ExternalHarnessUsage,
} from "./harnesses/externalRunner.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export const ANTIGRAVITY_DEFAULT_MODELS = [ANTIGRAVITY_DEFAULT_MODEL as AvailableModel];

/**
 * Only the Stagehand facade: the system prompt names its three tools, and the
 * saved-output handling has been exercised on no other surface.
 */
export const ANTIGRAVITY_TOOL_SURFACES: ToolSurface[] = ["stagehand_facade"];

export interface AntigravityRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedDeepagentsToolAdapter;
  signal?: AbortSignal;
  spawn?: AntigravityProcessSpawner;
  verifier?: ExternalHarnessVerifierConfig;
  env?: NodeJS.ProcessEnv;
}

/** The runner has no structured output mode, so a shared JSON override fails fast. */
export function assertAntigravityResultContract(env: NodeJS.ProcessEnv = process.env): void {
  if (readResultContract("marker", env) !== "marker") {
    throw new EvalsError(
      "antigravity supports only the EVAL_RESULT marker contract; unset EVAL_RESULT_CONTRACT.",
    );
  }
}

/** The Deep Agents MCP mount, after the contract check so no browser session starts first. */
export async function prepareAntigravityToolAdapter(
  input: DeepagentsToolAdapterInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PreparedDeepagentsToolAdapter> {
  assertAntigravityResultContract(env);
  return prepareDeepagentsToolAdapter(input);
}

export async function runAntigravityAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  spawn,
  verifier,
  env = process.env,
}: AntigravityRunnerInput): Promise<TaskResult> {
  assertAntigravityResultContract(env);
  const maxToolSteps = resolveStepBudget({
    harnessEnvKey: "EVAL_ANTIGRAVITY_MAX_STEPS",
    dataset: plan.dataset,
    harnessDefault: 50,
  });
  const runnerDir = resolveAntigravityRunnerDir();
  const sdkVersion = readAntigravitySdkVersion(runnerDir);
  const thinkingLevel = readAntigravityThinkingLevel();
  return runExternalHarnessTask({
    harness: "antigravity",
    implementation: { name: "antigravity_sdk", version: 1, ...(sdkVersion && { sdkVersion }) },
    plan,
    model,
    logger,
    toolAdapter,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "Antigravity did not report success",
    stepBudget: maxToolSteps,
    stepBudgetUnit: "tool_calls",
    systemPromptMode: "native",
    configuration: { ...(thinkingLevel && { requestedThinkingLevel: thinkingLevel }) },
    runSession: async (prompt, systemPrompt) => {
      const sessionResult = await runAntigravitySession({
        prompt,
        model,
        logger,
        signal,
        spawn,
        session: {
          runnerDir,
          ...(toolAdapter?.cwd && { cwd: toolAdapter.cwd }),
          ...(toolAdapter?.env && { env: toolAdapter.env }),
          ...(toolAdapter?.mcpServers && { mcpServers: toolAdapter.mcpServers }),
          systemPrompt: `${systemPrompt}\n\n${ANTIGRAVITY_FACADE_SYSTEM_PROMPT}`,
          maxToolSteps,
        },
        onToolResult: (_name: string, server?: string) => {
          if (server && toolAdapter?.recordObservation) toolAdapter.recordObservation();
        },
      });
      return {
        raw: sessionResult,
        resultText: sessionResult.finalMessage,
        transcriptText: buildAntigravityTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.stopReason ||
          (sessionResult.status === "sdk_error"
            ? stringifyError(sessionResult.iterationError) || undefined
            : undefined),
        usage: normalizeAntigravityUsage(sessionResult.tokenUsage),
        metrics: {},
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      deepagentsAdapter.fromHarnessResult(
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
            reasoning_tokens: raw.tokenUsage.reasoningOutputTokens,
            cached_input_tokens: raw.tokenUsage.cacheReadInputTokens,
          },
        },
        taskSpec,
      ),
  });
}

function normalizeAntigravityUsage(usage: AntigravityTokenUsage): ExternalHarnessUsage {
  return {
    reported: usage.reported,
    inputTokens: toFiniteNumber(usage.inputTokens),
    outputTokens: toFiniteNumber(usage.outputTokens),
    cachedInputTokens: toFiniteNumber(usage.cacheReadInputTokens),
    reasoningOutputTokens: toFiniteNumber(usage.reasoningOutputTokens),
    totalTokens: toFiniteNumber(usage.totalTokens),
  };
}
