/**
 * Antigravity harness — Google's Antigravity agent loop driven headlessly
 * through its Python SDK (`google-antigravity`).
 *
 * The runner in packages/integrations/antigravity/runner speaks the Deep
 * Agents JSONL event protocol, so this harness reuses the Deep Agents session
 * driver (subprocess lifecycle, event parsing, status mapping) and trajectory
 * adapter. Antigravity keeps its native system prompt; the eval policy is
 * appended as a section. Builtin tools are disabled in the runner, leaving the
 * mounted MCP servers as the only tools.
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildDeepagentsTranscript,
  runDeepagentsSession,
  stringifyError,
  toFiniteNumber,
  type DeepagentsProcessSpawner,
  type DeepagentsTokenUsage,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import { getRepoRootDir } from "../runtimePaths.js";
import type { PreparedDeepagentsToolAdapter } from "./deepagentsToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { deepagentsAdapter } from "./harnesses/deepagentsAdapter.js";
import { runExternalHarnessTask, type ExternalHarnessUsage } from "./harnesses/externalRunner.js";
import { resolveStepBudget } from "./stepBudget.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export const ANTIGRAVITY_DEFAULT_MODELS = ["google/gemini-3.8-flash" as AvailableModel];

export interface AntigravityRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedDeepagentsToolAdapter;
  signal?: AbortSignal;
  spawn?: DeepagentsProcessSpawner;
  verifier?: ExternalHarnessVerifierConfig;
}

const ANTIGRAVITY_SYSTEM_PROMPT = `You are controlling one persistent browser that is already attached.
Do not launch another browser. Only the browser tools matter for this task.
You control the browser through exactly three tools:
- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.
Snapshot IDs are valid only for the latest snapshot of the active page. Snapshot again after
navigation or stale IDs. Finish with the EVAL_RESULT line requested by the task prompt.
`;

export function resolveAntigravityRunnerDir(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.STAGEHAND_ANTIGRAVITY_RUNNER_DIR ??
    path.join(getRepoRootDir(), "packages/integrations/antigravity/runner")
  );
}

/** google-antigravity version pinned in the runner's uv.lock, if readable. */
export function readAntigravitySdkVersion(runnerDir: string): string | undefined {
  try {
    const lock = fs.readFileSync(path.join(runnerDir, "uv.lock"), "utf8");
    return /\[\[package\]\]\s*name = "google-antigravity"\s*version = "([^"]+)"/.exec(lock)?.[1];
  } catch {
    return undefined;
  }
}

export async function runAntigravityAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  spawn,
  verifier,
}: AntigravityRunnerInput): Promise<TaskResult> {
  const maxToolSteps = resolveStepBudget({
    harnessEnvKey: "EVAL_ANTIGRAVITY_MAX_STEPS",
    dataset: plan.dataset,
    harnessDefault: 50,
  });
  const runnerDir = resolveAntigravityRunnerDir();
  const sdkVersion = readAntigravitySdkVersion(runnerDir);
  const thinkingLevel = process.env.EVAL_ANTIGRAVITY_THINKING_LEVEL || undefined;
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
      const sessionResult = await runDeepagentsSession({
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
          systemPrompt: `${systemPrompt}\n\n${ANTIGRAVITY_SYSTEM_PROMPT}`,
          maxToolSteps,
        },
        onToolResult: (_name: string, server?: string) => {
          if (server && toolAdapter?.recordObservation) toolAdapter.recordObservation();
        },
      });
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

function normalizeAntigravityUsage(usage: DeepagentsTokenUsage): ExternalHarnessUsage {
  return {
    reported: usage.reported,
    inputTokens: toFiniteNumber(usage.inputTokens),
    outputTokens: toFiniteNumber(usage.outputTokens),
    cachedInputTokens: toFiniteNumber(usage.cacheReadInputTokens),
    reasoningOutputTokens: toFiniteNumber(usage.reasoningOutputTokens),
    totalTokens: toFiniteNumber(usage.totalTokens),
  };
}
