import {
  buildDeepagentsTranscript,
  normalizeDeepagentsModel,
  runDeepagentsSession,
  stringifyError,
  toFiniteNumber,
  type DeepagentsProcessSpawner,
  type DeepagentsTokenUsage,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ToolSurface } from "../core/contracts/tool.js";
import type { PreparedDeepagentsToolAdapter } from "./deepagentsToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { deepagentsAdapter } from "./harnesses/deepagentsAdapter.js";
import {
  buildExternalHarnessPrompt,
  parseEvalResult,
  runExternalHarnessTask,
  type ExternalHarnessUsage,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { DeepagentsProcessSpawner } from "@browserbasehq/stagehand-integrations-deepagents-sdk";
export {
  buildDeepagentsTranscript,
  normalizeDeepagentsModel,
  runDeepagentsSession,
} from "@browserbasehq/stagehand-integrations-deepagents-sdk";

export interface DeepagentsRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedDeepagentsToolAdapter;
  signal?: AbortSignal;
  spawn?: DeepagentsProcessSpawner;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedDeepagentsResult extends ParsedEvalResult {}

const DEEPAGENTS_SHARED_SYSTEM_PROMPT = `You are controlling one persistent browser that is already attached.
Do not launch another browser.
Do not use file or todo tools, and do not use task tools; only the browser tools matter.
Finish with the EVAL_RESULT line requested by the task prompt.
`;

const DEEPAGENTS_FACADE_SYSTEM_PROMPT = `You control the browser through exactly three tools:
- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.

Use snapshot actions for simple interactions and run code for multi-step workflows. Snapshot IDs are
valid only for the latest snapshot of the active page. Snapshot again after navigation or stale IDs.
`;

export function buildDeepagentsSystemPrompt(toolSurface?: ToolSurface): string {
  if (toolSurface === "stagehand_facade") {
    return `${DEEPAGENTS_SHARED_SYSTEM_PROMPT}\n${DEEPAGENTS_FACADE_SYSTEM_PROMPT}`;
  }
  const toolGuidance =
    toolSurface === "playwright_mcp" || toolSurface === "chrome_devtools_mcp"
      ? "Use the MCP browser tools described in the task prompt."
      : "Use the browser tools described in the task prompt.";
  return `${DEEPAGENTS_SHARED_SYSTEM_PROMPT}\n${toolGuidance}`;
}

export const DEEPAGENTS_SYSTEM_PROMPT = buildDeepagentsSystemPrompt("stagehand_facade");

export function buildDeepagentsPrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({ plan, toolInstructions, resultContract: "marker" });
}

export function parseDeepagentsResult(raw: string): ParsedDeepagentsResult {
  return parseEvalResult(raw);
}

export async function runDeepagentsAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  spawn,
  verifier,
}: DeepagentsRunnerInput): Promise<TaskResult> {
  return runExternalHarnessTask({
    harness: "deepagents",
    plan,
    logger,
    toolAdapter,
    verifier,
    resultContract: "marker",
    fallbackErrorMessage: "Deep Agents did not report success",
    runSession: async (prompt) => {
      const sessionResult = await runDeepagentsSession({
        prompt,
        model,
        logger,
        signal,
        spawn,
        session: {
          ...(toolAdapter?.cwd && { cwd: toolAdapter.cwd }),
          ...(toolAdapter?.env && { env: toolAdapter.env }),
          ...(toolAdapter?.mcpServers && { mcpServers: toolAdapter.mcpServers }),
          systemPrompt: buildDeepagentsSystemPrompt(toolAdapter?.toolSurface),
          recursionLimit: readDeepagentsRecursionLimit(),
          maxToolSteps: readDeepagentsMaxToolSteps(),
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
        usage: normalizeDeepagentsUsage(sessionResult.tokenUsage),
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

function readDeepagentsMaxToolSteps(): number {
  for (const key of ["EVAL_DEEPAGENTS_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 50;
}

function readDeepagentsRecursionLimit(): number {
  const parsed = Number.parseInt(process.env.EVAL_DEEPAGENTS_RECURSION_LIMIT ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Math.max(100, readDeepagentsMaxToolSteps() * 4);
}

function normalizeDeepagentsUsage(usage: DeepagentsTokenUsage): ExternalHarnessUsage {
  return {
    inputTokens: toFiniteNumber(usage.inputTokens),
    outputTokens: toFiniteNumber(usage.outputTokens),
    cachedInputTokens: toFiniteNumber(usage.cacheReadInputTokens),
    reasoningOutputTokens: toFiniteNumber(usage.reasoningOutputTokens),
    totalTokens: toFiniteNumber(usage.totalTokens),
  };
}
