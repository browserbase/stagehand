import type { LogLine, Trajectory, TrajectoryStep } from "stagehand-v3";
import type { ExternalHarnessSessionOutcome } from "./externalRunner.js";

/**
 * Readable per-step trace shared by every external harness. It is derived
 * from the normalized Trajectory, so claude_code, codex, mastra, pi, eve,
 * deepagents, fx and cursor all log the exact same shape:
 *
 *   step 3 · think · <reasoning, clipped>
 *   step 3 · run · ok · await page.goto('https://…'); return page.title()  →  "Recreation.gov…"
 *   step 4 · screenshot · ok  →  [image 42 KB]
 *   step 5 · run · ERR · await page.click('#nope')  →  Timeout 30000ms exceeded
 *   result · completed · steps=5 · facade_calls=4 · in=12345 out=678 cached=9000
 *
 * Full code and results travel in `auxiliary` so Braintrust / parseLogLine
 * keep the detail expandable without polluting the message text.
 */

export const TRACE_LOG_CATEGORY = "trace";
export const TRACE_CLIP_CHARS = 200;
/** Cap on full-detail auxiliary payloads so a 300 KB snapshot cannot bloat a row. */
export const TRACE_AUXILIARY_MAX_CHARS = 16_000;

const SEPARATOR = " · ";
const ARROW = "  →  ";

export interface TraceLogSink {
  log(line: LogLine): void;
}

export interface TrajectoryTraceInput {
  trajectory: Pick<Trajectory, "steps">;
  outcome: Pick<ExternalHarnessSessionOutcome<unknown>, "status" | "stopReason" | "usage">;
  /** Optional per-step wall-clock durations (ms), indexed like `trajectory.steps`. */
  stepDurationsMs?: ReadonlyArray<number | undefined>;
  /** Which action names count as calls into the mounted browser surface. */
  isFacadeTool?: (name: string) => boolean;
}

/** Build every trace line for a completed run, in emission order. */
export function buildTrajectoryTraceLines(input: TrajectoryTraceInput): LogLine[] {
  const lines: LogLine[] = [];
  input.trajectory.steps.forEach((step, index) => {
    lines.push(...buildStepTraceLines(step, index + 1, input.stepDurationsMs?.[index]));
  });
  lines.push(buildResultTraceLine(input));
  return lines;
}

/** Emit the trace through an EvalLogger-compatible sink. */
export function emitTrajectoryTrace(sink: TraceLogSink, input: TrajectoryTraceInput): void {
  for (const line of buildTrajectoryTraceLines(input)) sink.log(line);
}

export function buildStepTraceLines(
  step: TrajectoryStep,
  ordinal: number,
  durationMs?: number,
): LogLine[] {
  const lines: LogLine[] = [];
  const reasoning = singleLine(step.reasoning);
  if (reasoning) {
    lines.push({
      category: TRACE_LOG_CATEGORY,
      level: 1,
      message: ["step " + ordinal, "think", clip(reasoning)].join(SEPARATOR),
      auxiliary: { reasoning: { value: capped(step.reasoning), type: "string" } },
    });
  }

  const tool = shortToolName(step.actionName);
  const ok = step.toolOutput?.ok !== false;
  const code = describeArgs(tool, step.actionArgs);
  const result = ok ? describeResult(tool, step) : describeError(step);
  const head = [
    "step " + ordinal,
    tool,
    ok ? "ok" : "ERR",
    ...(durationMs !== undefined ? [formatDuration(durationMs)] : []),
    ...(code ? [clip(code)] : []),
  ].join(SEPARATOR);

  lines.push({
    category: TRACE_LOG_CATEGORY,
    level: ok ? 1 : 0,
    message: result ? head + ARROW + clip(result) : head,
    auxiliary: buildStepAuxiliary(step, code),
  });
  return lines;
}

export function buildResultTraceLine(input: TrajectoryTraceInput): LogLine {
  const { outcome, trajectory } = input;
  const facadeCalls = input.isFacadeTool
    ? trajectory.steps.filter((step) => input.isFacadeTool!(step.actionName)).length
    : undefined;
  const usage = outcome.usage;
  const tokens = [
    `in=${usage.inputTokens}`,
    `out=${usage.outputTokens}`,
    ...(usage.cachedInputTokens !== undefined ? [`cached=${usage.cachedInputTokens}`] : []),
  ].join(" ");
  const message = [
    "result",
    outcome.status,
    ...(outcome.stopReason ? [singleLine(outcome.stopReason)] : []),
    `steps=${trajectory.steps.length}`,
    ...(facadeCalls !== undefined ? [`facade_calls=${facadeCalls}`] : []),
    tokens,
  ].join(SEPARATOR);
  return {
    category: TRACE_LOG_CATEGORY,
    level: 1,
    message: clip(message, 400),
    auxiliary: {
      usage: { value: JSON.stringify(usage), type: "object" },
    },
  };
}

/**
 * Collapse harness-specific tool naming onto the surface's own tool name:
 * `mcp__stagehand__run`, `stagehand.run`, `stagehand_run` all become `run`.
 * Names that carry no server prefix (Bash, node, web_search) pass through.
 */
export function shortToolName(actionName: string): string {
  let name = actionName.trim() || "tool";
  if (name.startsWith("mcp__")) {
    const separator = name.lastIndexOf("__");
    if (separator > 4) name = name.slice(separator + 2);
  } else if (name.includes(".")) {
    name = name.slice(name.lastIndexOf(".") + 1);
  }
  if (/^stagehand_(?:browser_)?(run|snapshot|screenshot)$/u.test(name)) {
    name = name.replace(/^stagehand_(?:browser_)?/u, "");
  }
  return name || "tool";
}

function describeArgs(tool: string, args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) return "";
  if (tool === "run") {
    if (typeof args.code === "string") return singleLine(args.code);
    if (args.actions !== undefined) return "actions " + (safeJson(args.actions) ?? "");
  }
  if (typeof args.command === "string") return singleLine(args.command);
  return safeJson(args) ?? "";
}

function describeResult(tool: string, step: TrajectoryStep): string {
  const imageBytes = imageEvidenceBytes(step);
  if (imageBytes > 0) return `[image ${formatKb(imageBytes)}]`;
  const result = step.toolOutput?.result;
  if (result === undefined || result === null) return "";
  if (Buffer.isBuffer(result)) return `[image ${formatKb(result.length)}]`;
  if (typeof result === "string") {
    if (tool === "screenshot") return "[image]";
    if (tool === "snapshot") return describeSnapshot(result);
    return singleLine(result);
  }
  return safeJson(result) ?? String(result);
}

function describeError(step: TrajectoryStep): string {
  const error = step.toolOutput?.error;
  if (error) return singleLine(error);
  const result = step.toolOutput?.result;
  if (typeof result === "string" && result) return singleLine(result);
  return safeJson(result) ?? "error";
}

function describeSnapshot(text: string): string {
  const lines = text.split(/\r?\n/u);
  const nodes = lines.filter((line) => /^\s*\[\d+(?:-\d+)?\]/u.test(line)).length;
  const first = lines.find((line) => line.trim())?.trim() ?? "";
  return nodes > 0 ? `[snapshot ${nodes} nodes] ${first}`.trim() : singleLine(text);
}

function imageEvidenceBytes(step: TrajectoryStep): number {
  let total = 0;
  for (const modality of step.agentEvidence?.modalities ?? []) {
    if (modality.type === "image") total += modality.bytes.length;
  }
  return total;
}

function buildStepAuxiliary(step: TrajectoryStep, code: string): LogLine["auxiliary"] {
  const auxiliary: NonNullable<LogLine["auxiliary"]> = {
    tool: { value: step.actionName, type: "string" },
  };
  if (code) auxiliary.code = { value: capped(code), type: "string" };
  const result = step.toolOutput?.result;
  if (result !== undefined && result !== null && !Buffer.isBuffer(result)) {
    auxiliary.result =
      typeof result === "string"
        ? { value: capped(result), type: "string" }
        : { value: capped(safeJson(result) ?? String(result)), type: "object" };
  }
  if (step.toolOutput?.error) {
    auxiliary.error = { value: capped(step.toolOutput.error), type: "string" };
  }
  return auxiliary;
}

function formatDuration(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

function formatKb(bytes: number): string {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function singleLine(value: string | undefined): string {
  return (value ?? "").replace(/\s+/gu, " ").trim();
}

function clip(value: string, max = TRACE_CLIP_CHARS): string {
  return value.length > max ? value.slice(0, max - 1) + "…" : value;
}

/**
 * Capped auxiliary payload. Objects are capped as JSON text, which can leave a
 * truncated string in a type:"object" entry — parseLogLine falls back to the
 * raw string in that case.
 */
function capped(value: string): string {
  return value.length > TRACE_AUXILIARY_MAX_CHARS
    ? value.slice(0, TRACE_AUXILIARY_MAX_CHARS) +
        `…[truncated ${value.length - TRACE_AUXILIARY_MAX_CHARS} chars]`
    : value;
}

function safeJson(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
