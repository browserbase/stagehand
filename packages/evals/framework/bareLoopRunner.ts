/**
 * bareLoopRunner — shared core for the three bare-loop harness runners
 * (vercel_ai_sdk, anthropic_sdk, openai_agents_sdk).
 *
 * These loops are reference instruments, not products. Each runner owns only
 * its provider-specific loop mechanics; everything shareable — the user
 * prompt, the browse tool description, tool-call recording, result
 * finalization, and verifier grading — lives here so the per-provider files
 * stay small enough to read in one sitting.
 *
 * System-prompt policy: the system prompt is EXACTLY the skill-mode text the
 * tool adapter resolved (bare one-liner / prompt_show variant / injected
 * skill) — no extra scaffolding is added, so results measure the CLI and its
 * docs rather than harness smarts. Task specifics (start URL, instruction,
 * EVAL_RESULT format) go in the user prompt, mirroring how a developer would
 * wire a one-off script.
 */
import { performance } from "node:perf_hooks";
import type { Trajectory } from "@browserbasehq/stagehand";
import type { EvalLogger } from "../logger.js";
import type { TaskResult } from "./types.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { PreparedExternalHarnessAdapter } from "./externalHarnessToolAdapter.js";
import { runBareBrowseCommand } from "./externalHarnessToolAdapter.js";
import {
  buildEvalResultInstructions,
  parseEvalResultText,
} from "./evalResultParser.js";
import { bareLoopAdapter } from "./harnesses/bareLoopAdapter.js";
import type { NormalizedToolCall } from "./harnesses/trajectoryAdapter.js";
import {
  gradeExternalTrajectory,
  type ExternalHarnessVerifierConfig,
} from "./verifierAdapter.js";

type MetricValue = { count: number; value: number };

export const BROWSE_TOOL_NAME = "browse";

export const BROWSE_TOOL_DESCRIPTION =
  'Run a single browse CLI command. Pass everything after "browse" as args, e.g. "open https://example.com" or "--help". One command per call; shell metacharacters are rejected.';

export function buildBareLoopUserPrompt(plan: ExternalHarnessTaskPlan): string {
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
    buildEvalResultInstructions(),
  ]
    .filter(Boolean)
    .join("\n");
}

export interface BareLoopToolRecorder {
  /** Execute one browse command, record it as a NormalizedToolCall, return output. */
  execute(args: string, reasoning?: string): Promise<string>;
  readonly calls: NormalizedToolCall[];
}

/**
 * Cap on the tool output returned to the model per call: without a cap, a
 * few large `snapshot` / `get markdown` outputs across a long loop overflow
 * the context window. The recorded trajectory keeps the same clipped text —
 * the verifier should ground on what the model actually saw.
 */
export function readToolOutputLimit(): number {
  const raw = process.env.EVAL_BARE_LOOP_TOOL_OUTPUT_LIMIT;
  if (!raw) return 20_000;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 20_000;
}

/**
 * Build the recorder every bare loop routes its tool executions through.
 * Recording at execution time (instead of re-parsing an event stream after
 * the fact) is what keeps these adapters trivially verifiable.
 */
export function createBareLoopToolRecorder(
  adapter: Pick<
    PreparedExternalHarnessAdapter,
    "browseBinPath" | "cwd" | "env"
  >,
  logger: EvalLogger,
  category: string,
  toolTimeoutMs?: number,
): BareLoopToolRecorder {
  const calls: NormalizedToolCall[] = [];
  const outputLimit = readToolOutputLimit();
  return {
    calls,
    async execute(args: string, reasoning?: string): Promise<string> {
      const started = performance.now();
      const { ok, output } = await runBareBrowseCommand(
        adapter,
        args,
        toolTimeoutMs ?? readToolTimeoutMs(),
      );
      const durationMs = Math.round(performance.now() - started);
      logger.log({
        category,
        message: `browse ${clip(args, 200)} -> ${ok ? "ok" : "error"} (${durationMs}ms, ${output.length} chars)`,
        level: 1,
      });
      const clipped = clip(output, outputLimit);
      calls.push({
        name: BROWSE_TOOL_NAME,
        args: { args },
        result: clipped,
        ok,
        ...(!ok && { error: clip(output, 2000) }),
        ...(reasoning && { reasoning }),
      });
      return clipped;
    },
  };
}

export interface FinalizeBareLoopResultInput {
  /** Harness id, used as logger category and metrics prefix. */
  harness: string;
  toolCalls: NormalizedToolCall[];
  /** The model's final text output (may contain the EVAL_RESULT line). */
  finalText: string;
  /** "complete" unless the loop aborted/errored. */
  status: Trajectory["status"];
  /** Human-readable stop reason when the loop ended abnormally. */
  stopReason?: string;
  usage?: Partial<Trajectory["usage"]>;
  stepsUsed: number;
  maxSteps: number;
  logger: EvalLogger;
  verifier?: ExternalHarnessVerifierConfig;
}

/**
 * Fold a finished bare loop into a TaskResult: parse the self-reported
 * EVAL_RESULT line, attach metrics, and (when a verifier is configured) grade
 * the recorded trajectory with gradeExternalTrajectory — the same post-hoc
 * ground-truth path claude_code/codex use, unchanged.
 */
export async function finalizeBareLoopResult(
  input: FinalizeBareLoopResultInput,
): Promise<TaskResult> {
  const parsed = parseEvalResultText(input.finalText);
  const errorMessage =
    parsed.summary ??
    input.stopReason ??
    (input.finalText || `${input.harness} did not report success`);

  const prefix = input.harness;
  // TaskResult field names are camelCase by convention; the harness ids
  // themselves (vercel_ai_sdk, openai_agents_sdk, ...) are snake_case, so
  // camelCase only the two field names built from it. Metrics keys below
  // intentionally keep the snake_case harness id -- that's the existing
  // metrics-naming convention across every harness (claude_code, codex, ...).
  const fieldPrefix = toCamelCase(prefix);
  const baseResult: TaskResult = {
    _success: parsed.success,
    error: !parsed.success ? errorMessage : undefined,
    reasoning: parsed.summary,
    finalAnswer: parsed.finalAnswer,
    rawResult: parsed.raw,
    [`${fieldPrefix}Status`]:
      input.status === "complete" ? "completed" : "error",
    ...(input.stopReason && {
      [`${fieldPrefix}StopReason`]: input.stopReason,
    }),
    logs: input.logger.getLogs(),
    metrics: {
      [`${prefix}_steps`]: metricValue(input.stepsUsed),
      [`${prefix}_max_steps`]: metricValue(input.maxSteps),
      [`${prefix}_tool_calls`]: metricValue(input.toolCalls.length),
      [`${prefix}_input_tokens`]: metricValue(input.usage?.input_tokens),
      [`${prefix}_output_tokens`]: metricValue(input.usage?.output_tokens),
      [`${prefix}_total_tokens`]: metricValue(
        (input.usage?.input_tokens ?? 0) + (input.usage?.output_tokens ?? 0),
      ),
    },
  };

  if (!input.verifier) {
    return baseResult;
  }

  return gradeExternalTrajectory({
    buildTrajectory: () =>
      bareLoopAdapter.fromHarnessResult(
        {
          toolCalls: input.toolCalls,
          finalAnswer: parsed.finalAnswer ?? input.finalText,
          status: input.status,
          usage: input.usage,
        },
        input.verifier.taskSpec,
      ),
    verifier: input.verifier,
    baseResult,
    errorMessage,
    category: input.harness,
    logger: input.logger,
  });
}

export function readToolTimeoutMs(): number {
  const raw = process.env.EVAL_BARE_LOOP_TOOL_TIMEOUT_MS;
  if (!raw) return 60_000;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 60_000;
}

/** "vercel_ai_sdk" -> "vercelAiSdk". Used only for TaskResult field names. */
function toCamelCase(value: string): string {
  return value.replace(/_([a-z0-9])/g, (_match, ch: string) =>
    ch.toUpperCase(),
  );
}

export function stripProviderPrefix(model: string): string {
  return model.includes("/") ? model.slice(model.indexOf("/") + 1) : model;
}

function metricValue(value: unknown): MetricValue {
  const parsed =
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return { count: 1, value: parsed };
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 1)}…`;
}

export function stringifyLoopError(value: unknown): string {
  if (!value) return "";
  if (value instanceof Error) return redactSecrets(value.message);
  if (typeof value === "string") return redactSecrets(value);
  try {
    return redactSecrets(JSON.stringify(value) ?? String(value));
  } catch {
    return redactSecrets(String(value));
  }
}

/**
 * Provider/SDK error messages can echo request details. Scrub the common
 * secret shapes (API keys, bearer tokens, signed query params) before the
 * message lands in TaskResult.error / stop reasons.
 */
function redactSecrets(text: string): string {
  return text
    .replace(/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g, "[redacted]")
    .replace(/\bbb_(?:live|test)_[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]")
    .replace(
      /([?&](?:key|api_key|apikey|token|access_token|signature|sig|secret)=)[^&\s"']+/gi,
      "$1[redacted]",
    );
}
