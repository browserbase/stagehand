import {
  buildPydanticAiTranscript,
  runPydanticAiSession,
  stringifyError,
  toFiniteNumber,
  type PydanticAiProcessSpawner,
  type PydanticAiTokenUsage,
} from "@browserbasehq/stagehand-integrations-pydantic-ai-sdk";
import type { AvailableModel } from "stagehand-v3";
import type { EvalLogger } from "../logger.js";
import type { ToolSurface } from "../core/contracts/tool.js";
import type { PreparedPydanticAiToolAdapter } from "./pydanticAiToolAdapter.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { pydanticAiAdapter } from "./harnesses/pydanticAiAdapter.js";
import {
  buildExternalHarnessPrompt,
  parseEvalResult,
  runExternalHarnessTask,
  type ExternalHarnessUsage,
  type ParsedEvalResult,
} from "./harnesses/externalRunner.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessVerifierConfig } from "./verifierAdapter.js";

export type { PydanticAiProcessSpawner } from "@browserbasehq/stagehand-integrations-pydantic-ai-sdk";
export {
  buildPydanticAiTranscript,
  normalizePydanticAiModel,
  runPydanticAiSession,
} from "@browserbasehq/stagehand-integrations-pydantic-ai-sdk";

export interface PydanticAiRunnerInput {
  plan: ExternalHarnessTaskPlan;
  model: AvailableModel;
  logger: EvalLogger;
  toolAdapter?: PreparedPydanticAiToolAdapter;
  signal?: AbortSignal;
  spawn?: PydanticAiProcessSpawner;
  verifier?: ExternalHarnessVerifierConfig;
}

export interface ParsedPydanticAiResult extends ParsedEvalResult {}

const PYDANTIC_AI_SHARED_SYSTEM_PROMPT = `You are controlling one persistent browser that is already attached.
Do not launch another browser.
Only the browser tools matter.
Return structured JSON matching the requested success/summary/finalAnswer schema.
`;

const PYDANTIC_AI_FACADE_SYSTEM_PROMPT = `You control the browser through exactly three tools:
- snapshot: inspect the active page and hydrate bracketed element IDs.
- run: provide either snapshot actions or JavaScript using the Playwright-shaped page API.
- screenshot: inspect the rendered page visually.

Use snapshot actions for simple interactions and run code for multi-step workflows. Snapshot IDs are
valid only for the latest snapshot of the active page. Snapshot again after navigation or stale IDs.
`;

export function buildPydanticAiSystemPrompt(toolSurface?: ToolSurface): string {
  if (toolSurface === "stagehand_facade") {
    return `${PYDANTIC_AI_SHARED_SYSTEM_PROMPT}\n${PYDANTIC_AI_FACADE_SYSTEM_PROMPT}`;
  }
  const toolGuidance =
    toolSurface === "playwright_mcp" || toolSurface === "chrome_devtools_mcp"
      ? "Use the MCP browser tools described in the task prompt."
      : "Use the browser tools described in the task prompt.";
  return `${PYDANTIC_AI_SHARED_SYSTEM_PROMPT}\n${toolGuidance}`;
}

export const PYDANTIC_AI_SYSTEM_PROMPT = buildPydanticAiSystemPrompt("stagehand_facade");

export function buildPydanticAiPrompt(
  plan: ExternalHarnessTaskPlan,
  toolInstructions?: string,
): string {
  return buildExternalHarnessPrompt({
    plan,
    toolInstructions,
    resultContract: "structured_output",
  });
}

export function parsePydanticAiResult(raw: string): ParsedPydanticAiResult {
  return parseEvalResult(raw);
}

export async function runPydanticAiAgent({
  plan,
  model,
  logger,
  toolAdapter,
  signal,
  spawn,
  verifier,
}: PydanticAiRunnerInput): Promise<TaskResult> {
  return runExternalHarnessTask({
    harness: "pydantic_ai",
    plan,
    logger,
    toolAdapter,
    verifier,
    resultContract: "structured_output",
    fallbackErrorMessage: "Pydantic AI did not report success",
    runSession: async (prompt) => {
      const sessionResult = await runPydanticAiSession({
        prompt,
        model,
        logger,
        signal,
        spawn,
        session: {
          ...(toolAdapter?.cwd && { cwd: toolAdapter.cwd }),
          ...(toolAdapter?.env && { env: toolAdapter.env }),
          ...(toolAdapter?.mcpServers && { mcpServers: toolAdapter.mcpServers }),
          systemPrompt: buildPydanticAiSystemPrompt(toolAdapter?.toolSurface),
          recursionLimit: readPydanticAiRecursionLimit(),
          maxToolSteps: readPydanticAiMaxToolSteps(),
        },
        onToolResult: (_name: string, server?: string) => {
          if (server && toolAdapter?.recordObservation) toolAdapter.recordObservation();
        },
      });
      return {
        raw: sessionResult,
        resultText: sessionResult.finalMessage,
        transcriptText: buildPydanticAiTranscript(sessionResult.events),
        iterationError: sessionResult.iterationError,
        status: sessionResult.status,
        stopReason:
          sessionResult.stopReason ||
          (sessionResult.status === "sdk_error"
            ? stringifyError(sessionResult.iterationError) || undefined
            : undefined),
        usage: normalizePydanticAiUsage(sessionResult.tokenUsage),
        metrics: {},
      };
    },
    toTrajectory: (
      { raw, parsed, finalObservation, stepObservations, observedToolName, status },
      taskSpec,
    ) =>
      pydanticAiAdapter.fromHarnessResult(
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
  if (!verifier && result.harnessStatus === "sdk_error" && result._success === true) {
    return {
      ...result,
      _success: false,
      error: result.harnessStopReason ?? "Pydantic AI did not report success",
    };
  }
  return result;
}

function readPydanticAiMaxToolSteps(): number {
  for (const key of ["EVAL_PYDANTIC_AI_MAX_STEPS", "AGENT_EVAL_MAX_STEPS"]) {
    const parsed = Number.parseInt(process.env[key] ?? "", 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return 50;
}

function readPydanticAiRecursionLimit(): number {
  const parsed = Number.parseInt(process.env.EVAL_PYDANTIC_AI_RECURSION_LIMIT ?? "", 10);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return Math.max(100, readPydanticAiMaxToolSteps() * 4);
}

function normalizePydanticAiUsage(usage: PydanticAiTokenUsage): ExternalHarnessUsage {
  return {
    inputTokens: toFiniteNumber(usage.inputTokens),
    outputTokens: toFiniteNumber(usage.outputTokens),
    cachedInputTokens: toFiniteNumber(usage.cacheReadInputTokens),
    reasoningOutputTokens: toFiniteNumber(usage.reasoningOutputTokens),
    totalTokens: toFiniteNumber(usage.totalTokens),
  };
}
