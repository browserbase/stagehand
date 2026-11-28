import fsp from "node:fs/promises";
import path from "node:path";
import {
  buildDeepagentsTranscript,
  stringifyError,
  toFiniteNumber,
  type DeepagentsProcessSpawner,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import {
  KARPO_BROWSER_HARNESS,
  KARPO_BROWSER_PATH_ENV,
  runKarpoBrowserSession,
} from "@browserbasehq/stagehand-integrations-karpo-browser";
import type { AvailableModel } from "stagehand-v3";
import type { ToolSurface } from "../core/contracts/tool.js";
import { EvalsError } from "../errors.js";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessPrepareInput } from "./benchHarness.js";
import {
  prepareDeepagentsToolAdapter,
  type PreparedDeepagentsToolAdapter,
} from "./deepagentsToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { deepagentsAdapter } from "./harnesses/deepagentsAdapter.js";
import {
  EVAL_RESULT_SCHEMA,
  readResultContract,
  runExternalHarnessTask,
} from "./harnesses/externalRunner.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

/** A label only: the agent reads its models from its own environment. */
export const KARPO_BROWSER_MODEL = "karpo-browser/controller" as AvailableModel;
export const KARPO_BROWSER_TOOL_SURFACES: ToolSurface[] = ["stagehand_facade"];

const MAX_STEPS_ENV = "EVAL_KARPO_BROWSER_MAX_STEPS";
const RUN_SECONDS_ENV = "EVAL_KARPO_BROWSER_RUN_SECONDS";
const DEFAULT_RUN_SECONDS = 2_400;
const AGENT_RECORDS_DIR = "agent-records";
const TRAJECTORY_AGENT_DIR = "agent";

export interface KarpoBrowserRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter: PreparedDeepagentsToolAdapter;
  signal?: AbortSignal;
  spawn?: DeepagentsProcessSpawner;
  verifier?: ExternalHarnessVerifierConfig;
  env?: NodeJS.ProcessEnv;
}

/**
 * The agent drives the row's Browserbase session over its own CDP connection,
 * so the harness runs on Browserbase only.
 */
export async function prepareKarpoBrowserToolAdapter(
  input: ExternalHarnessPrepareInput,
): Promise<PreparedDeepagentsToolAdapter> {
  if (input.environment !== "BROWSERBASE") {
    throw new EvalsError(`${KARPO_BROWSER_HARNESS} runs on Browserbase only: use -e browserbase.`);
  }
  return prepareDeepagentsToolAdapter(input, {
    harness: KARPO_BROWSER_HARNESS,
    label: "karpo-browser",
    supportedToolSurfaces: KARPO_BROWSER_TOOL_SURFACES,
  });
}

export async function runKarpoBrowserAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  spawn,
  verifier,
  env = process.env,
}: KarpoBrowserRunnerInput): Promise<TaskResult> {
  const agentPath = env[KARPO_BROWSER_PATH_ENV]?.trim();
  if (!agentPath || !path.isAbsolute(agentPath)) {
    throw new EvalsError(`${KARPO_BROWSER_PATH_ENV} must be the absolute path of the agent.`);
  }
  const { provider, sessionId } = toolAdapter.browserSession;
  if (provider !== "browserbase" || !sessionId) {
    throw new EvalsError(`${KARPO_BROWSER_HARNESS} needs the row's Browserbase session.`);
  }
  const resultContract = readResultContract("marker", env);
  const maxToolSteps = resolveStepBudget({
    harnessEnvKey: MAX_STEPS_ENV,
    dataset: plan.dataset,
    harnessDefault: 50,
    env,
  });
  const runSeconds = readPositiveInt(env[RUN_SECONDS_ENV]) ?? DEFAULT_RUN_SECONDS;
  const recordsDir = path.join(toolAdapter.cwd, AGENT_RECORDS_DIR);
  const result = await runExternalHarnessTask({
    harness: KARPO_BROWSER_HARNESS,
    plan,
    model,
    logger,
    toolAdapter,
    verifier,
    resultContract,
    fallbackErrorMessage: "karpo-browser did not report success",
    stepBudget: maxToolSteps,
    stepBudgetUnit: "tool_calls",
    configuration: { runSeconds },
    systemPromptMode: "native",
    runSession: async (prompt, systemPrompt) => {
      const sessionResult = await runKarpoBrowserSession({
        prompt,
        model,
        logger,
        ...(signal && { signal }),
        ...(spawn && { spawn }),
        session: {
          agentPath,
          cwd: toolAdapter.cwd,
          env: { ...toolAdapter.env, BROWSERBASE_SESSION_ID: sessionId },
          mcpServers: toolAdapter.mcpServers,
          systemPrompt,
          maxToolSteps,
          ...(resultContract === "structured_output" && { resultSchema: EVAL_RESULT_SCHEMA }),
          instruction: plan.instruction,
          startUrl: plan.startUrl,
          runSeconds,
          recordsDir,
        },
        onToolResult: (_name: string, server?: string) => {
          if (server && toolAdapter.recordObservation) toolAdapter.recordObservation();
        },
      });
      const usage = sessionResult.tokenUsage;
      return {
        raw: sessionResult,
        resultText: sessionResult.finalMessage,
        transcriptText: buildDeepagentsTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.stopReason ||
          (sessionResult.status === "sdk_error"
            ? stringifyError(sessionResult.iterationError) || undefined
            : undefined),
        usage: {
          reported: usage.reported,
          inputTokens: toFiniteNumber(usage.inputTokens),
          outputTokens: toFiniteNumber(usage.outputTokens),
          cachedInputTokens: toFiniteNumber(usage.cacheReadInputTokens),
          reasoningOutputTokens: toFiniteNumber(usage.reasoningOutputTokens),
          totalTokens: toFiniteNumber(usage.totalTokens),
        },
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
  await keepAgentRecords(recordsDir, result.trajectoryDir, logger);
  return result;
}

/**
 * The row's working directory is removed after the run, so the agent's records
 * are copied into the trajectory. A failed copy is logged and the row stands.
 */
async function keepAgentRecords(
  recordsDir: string,
  trajectoryDir: unknown,
  logger: EvalLogger,
): Promise<void> {
  if (typeof trajectoryDir !== "string") return;
  if (!(await isDirectory(trajectoryDir)) || !(await isDirectory(recordsDir))) return;
  try {
    await fsp.cp(recordsDir, path.join(trajectoryDir, TRAJECTORY_AGENT_DIR), { recursive: true });
  } catch (error) {
    logger.warn({
      category: KARPO_BROWSER_HARNESS,
      message: `could not keep the agent's execution records: ${stringifyError(error)}`,
      level: 1,
    });
  }
}

async function isDirectory(dir: string): Promise<boolean> {
  try {
    return (await fsp.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

function readPositiveInt(raw: string | undefined): number | undefined {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
