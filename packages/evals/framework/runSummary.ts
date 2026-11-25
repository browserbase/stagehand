import type { EvalInput } from "../types/evals.js";
import { caseDisplayName } from "./caseIdentity.js";

export type SummaryRow = {
  input: EvalInput;
  output: { _success: boolean; [key: string]: unknown };
  name: string;
};

export interface CellSummary {
  cell: string;
  harness: string;
  toolSurface?: string;
  model: string;
  total: number;
  passed: number;
  maxTurns: number;
  sdkError: number;
  gated: number;
  ungraded: number;
  retried: number;
}

export type FailureKind = "sdk_error" | "max_turns" | "ungraded" | "gated" | "fail";

export type RowOutcome = "pass" | FailureKind;

export interface FailureRow {
  kind: FailureKind;
  harness: string;
  task: string;
  model: string;
  reason?: string;
  sessionUrl?: string;
  logPath?: string;
}

export interface VerifierSummary {
  attempted: number;
  graded: number;
  ungraded: number;
  unverifiableCriteria: number;
  totalCriteria: number;
  passesWithoutBrowserUse: number;
}

export interface RunSummaryJson {
  experimentName: string;
  experimentUrl?: string;
  judgeModel?: string;
  trajectoryGroup?: string;
  logDir?: string;
  summary: { passed: number; failed: number; total: number; passRate: number };
  usage: RunUsage;
  gates: Record<string, number>;
  cells: CellSummary[];
  verifier: VerifierSummary;
  failures: FailureRow[];
  deadJudge: boolean;
}

export interface RunUsage {
  totalTokens: number;
  costUsd?: number;
  costRows: number;
}

function readMetric(output: Record<string, unknown>, name: string): number | undefined {
  const metrics = output.metrics;
  if (typeof metrics !== "object" || metrics === null) return undefined;
  const metric = (metrics as Record<string, unknown>)[name];
  if (typeof metric !== "object" || metric === null) return undefined;
  const value = (metric as { value?: unknown }).value;
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function summarizeUsage(results: SummaryRow[]): RunUsage {
  let totalTokens = 0;
  let costUsd = 0;
  let costRows = 0;
  for (const { output } of results) {
    totalTokens += readMetric(output, "harness_total_tokens") ?? 0;
    const cost = readMetric(output, "harness_cost_usd");
    if (cost !== undefined) {
      costUsd += cost;
      costRows += 1;
    }
  }
  return { totalTokens, ...(costRows > 0 && { costUsd }), costRows };
}

export function summarizeGates(results: SummaryRow[]): Record<string, number> {
  const gates: Record<string, number> = {};
  for (const { output } of results) {
    if (output._success || !isGated(output)) continue;
    for (const gate of output.outcomeGates as string[]) gates[gate] = (gates[gate] ?? 0) + 1;
  }
  return gates;
}

const FAILURE_ORDER: Record<FailureKind, number> = {
  sdk_error: 0,
  max_turns: 1,
  ungraded: 2,
  gated: 3,
  fail: 4,
};

function readToolSurface(input: EvalInput): string | undefined {
  const value = input.params?.toolSurface;
  return typeof value === "string" ? value : undefined;
}

function readFacadeToolCalls(output: Record<string, unknown>): number | undefined {
  const metrics = output.metrics;
  if (typeof metrics !== "object" || metrics === null) return undefined;
  const metric = (metrics as Record<string, unknown>).facade_tool_calls;
  if (typeof metric !== "object" || metric === null) return undefined;
  const value = (metric as { value?: unknown }).value;
  return typeof value === "number" ? value : undefined;
}

function isGraded(output: Record<string, unknown>): boolean {
  return typeof output.criterionCount === "number";
}

function isUngraded(output: Record<string, unknown>): boolean {
  return !isGraded(output) && output.verifierError !== undefined;
}

export function cellKey(harness: string, toolSurface: string | undefined, model: string): string {
  return [harness, toolSurface, model].filter(Boolean).join(" × ");
}

export function summarizeCells(results: SummaryRow[], harness: string): CellSummary[] {
  const cells = new Map<string, CellSummary>();
  for (const { input, output } of results) {
    const toolSurface = readToolSurface(input);
    const key = cellKey(harness, toolSurface, input.modelName);
    const cell = cells.get(key) ?? {
      cell: key,
      harness,
      ...(toolSurface && { toolSurface }),
      model: input.modelName,
      total: 0,
      passed: 0,
      maxTurns: 0,
      sdkError: 0,
      gated: 0,
      ungraded: 0,
      retried: 0,
    };
    cell.total += 1;
    if (output._success) cell.passed += 1;
    if (output.harnessStatus === "max_turns") cell.maxTurns += 1;
    if (output.harnessStatus === "sdk_error") cell.sdkError += 1;
    if (!output._success && isGated(output)) cell.gated += 1;
    if (isUngraded(output)) cell.ungraded += 1;
    if ((output.providerThrottled as { retried?: boolean } | undefined)?.retried) cell.retried += 1;
    cells.set(key, cell);
  }
  return [...cells.values()];
}

export function summarizeVerifier(results: SummaryRow[]): VerifierSummary {
  const summary: VerifierSummary = {
    attempted: 0,
    graded: 0,
    ungraded: 0,
    unverifiableCriteria: 0,
    totalCriteria: 0,
    passesWithoutBrowserUse: 0,
  };
  for (const { output } of results) {
    if (isGraded(output)) {
      summary.attempted += 1;
      summary.graded += 1;
      summary.totalCriteria += output.criterionCount as number;
      summary.unverifiableCriteria += Array.isArray(output.evidenceInsufficient)
        ? output.evidenceInsufficient.length
        : 0;
      if (output._success && readFacadeToolCalls(output) === 0) {
        summary.passesWithoutBrowserUse += 1;
      }
    } else if (isUngraded(output)) {
      summary.attempted += 1;
      summary.ungraded += 1;
    }
  }
  return summary;
}

export function isDeadJudgeRun(verifier: VerifierSummary): boolean {
  return verifier.attempted > 0 && verifier.graded === 0;
}

function readReason(output: Record<string, unknown>): string | undefined {
  for (const candidate of [output.harnessStopReason, output.verifierError, output.error]) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

function isGated(output: Record<string, unknown>): boolean {
  return (
    output.judgeOutcomeSuccess === true &&
    Array.isArray(output.outcomeGates) &&
    output.outcomeGates.length > 0
  );
}

function classifyFailure(output: Record<string, unknown>): FailureKind {
  if (output.harnessStatus === "sdk_error") return "sdk_error";
  if (output.harnessStatus === "max_turns") return "max_turns";
  if (isUngraded(output)) return "ungraded";
  if (isGated(output)) return "gated";
  return "fail";
}

export function classifyRowOutcome(output: Record<string, unknown>): RowOutcome {
  return output._success === true ? "pass" : classifyFailure(output);
}

export function collectFailures(results: SummaryRow[], harness: string): FailureRow[] {
  return results
    .filter(({ output }) => !output._success)
    .map(({ input, output, name }) => {
      const reason = readReason(output);
      const sessionUrl = typeof output.sessionUrl === "string" ? output.sessionUrl : undefined;
      const logPath = typeof output.logPath === "string" ? output.logPath : undefined;
      return {
        kind: classifyFailure(output),
        harness,
        task: caseDisplayName({ name, params: input.params }),
        model: input.modelName,
        ...(reason && { reason }),
        ...(sessionUrl && { sessionUrl }),
        ...(logPath && { logPath }),
      };
    })
    .sort((a, b) => FAILURE_ORDER[a.kind] - FAILURE_ORDER[b.kind] || a.task.localeCompare(b.task));
}

export function buildRunSummaryJson(input: {
  results: SummaryRow[];
  harness: string;
  experimentName: string;
  experimentUrl?: string;
  judgeModel?: string;
  trajectoryGroup?: string;
  logDir?: string;
}): RunSummaryJson {
  const passed = input.results.filter((row) => row.output._success).length;
  const total = input.results.length;
  const verifier = summarizeVerifier(input.results);
  return {
    experimentName: input.experimentName,
    ...(input.experimentUrl && { experimentUrl: input.experimentUrl }),
    ...(input.judgeModel && { judgeModel: input.judgeModel }),
    ...(input.trajectoryGroup && { trajectoryGroup: input.trajectoryGroup }),
    ...(input.logDir && { logDir: input.logDir }),
    summary: {
      passed,
      failed: total - passed,
      total,
      passRate: total === 0 ? 0 : Math.round((passed / total) * 100),
    },
    usage: summarizeUsage(input.results),
    gates: summarizeGates(input.results),
    cells: summarizeCells(input.results, input.harness),
    verifier,
    failures: collectFailures(input.results, input.harness),
    deadJudge: isDeadJudgeRun(verifier),
  };
}
