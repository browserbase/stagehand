import fs from "node:fs";
import path from "node:path";

export type HermesPilotSuccessMode = "outcome" | "process" | "both";

export interface HermesPilotRecordContext {
  record: Record<string, unknown>;
  runDir: string;
  identity: {
    taskId: string;
    surface: string;
    verifierModel: string;
  };
  successMode: HermesPilotSuccessMode;
}

export interface ValidVerifierSidecar {
  schema_version: 1;
  task_id: string;
  surface: string;
  verifier_model: string;
  outcome: boolean;
  process_score: number;
  criterion_count: number;
  evidence_insufficient_count: number;
  trajectory_dir: string;
}

export interface EffectiveHermesPilotRecord {
  record: Record<string, unknown>;
  regraded: boolean;
}

function readRecord(file: string): Record<string, unknown> {
  const value = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Malformed verifier regrade: ${file}`);
  }
  return value as Record<string, unknown>;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

/**
 * Read and validate the optional verifier-result.json next to a raw record.
 * Missing sidecars are not errors; present but malformed or mismatched sidecars
 * fail closed so they can never silently change benchmark results.
 */
export function readValidVerifierSidecar(
  context: HermesPilotRecordContext,
): ValidVerifierSidecar | undefined {
  const file = path.join(context.runDir, "verifier-result.json");
  if (!fs.existsSync(file)) return undefined;

  const value = readRecord(file);
  const expected = {
    schema_version: 1,
    task_id: context.identity.taskId,
    surface: context.identity.surface,
    verifier_model: context.identity.verifierModel,
  };
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (value[key] !== expectedValue) {
      throw new Error(`Verifier regrade identity mismatch at ${key}`);
    }
  }

  if (
    typeof value.outcome !== "boolean" ||
    !isFiniteNumber(value.process_score) ||
    value.process_score < 0 ||
    value.process_score > 1 ||
    !isNonnegativeInteger(value.criterion_count) ||
    value.criterion_count < 1 ||
    !isNonnegativeInteger(value.evidence_insufficient_count) ||
    typeof value.trajectory_dir !== "string" ||
    value.trajectory_dir.trim().length === 0
  ) {
    throw new Error("Verifier regrade is incomplete");
  }
  let trajectoryIsDirectory = false;
  try {
    trajectoryIsDirectory = fs.statSync(value.trajectory_dir).isDirectory();
  } catch {
    // Report the same stable validation error for absent and unreadable paths.
  }
  if (!trajectoryIsDirectory) throw new Error("Verifier regrade is incomplete");

  return value as unknown as ValidVerifierSidecar;
}

export function hermesPilotVerifierSucceeded(
  sidecar: Pick<ValidVerifierSidecar, "outcome" | "process_score" | "evidence_insufficient_count">,
  successMode: HermesPilotSuccessMode,
): boolean {
  if (sidecar.evidence_insufficient_count !== 0) return false;
  const processSucceeded = sidecar.process_score >= 0.8;
  if (successMode === "outcome") return sidecar.outcome;
  if (successMode === "process") return processSucceeded;
  return sidecar.outcome && processSucceeded;
}

/** Resolve an immutable effective view while retaining record.json as provenance. */
export function resolveEffectiveHermesPilotRecord(
  context: HermesPilotRecordContext,
): EffectiveHermesPilotRecord {
  if (context.record.status !== "error") {
    return { record: context.record, regraded: false };
  }
  const sidecar = readValidVerifierSidecar(context);
  if (!sidecar) return { record: context.record, regraded: false };

  const success = hermesPilotVerifierSucceeded(sidecar, context.successMode);
  return {
    regraded: true,
    record: {
      ...context.record,
      status: success ? "verified_passed" : "verified_failed",
      accuracy: success,
      verifier_graded: true,
      outcome: sidecar.outcome,
      process_score: sidecar.process_score,
      criterion_count: sidecar.criterion_count,
      evidence_insufficient_count: sidecar.evidence_insufficient_count,
      verifier_error: null,
      trajectory_dir: sidecar.trajectory_dir,
    },
  };
}

function countStatuses(records: Array<Record<string, unknown>>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    const status = String(record.status);
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function summarizeHermesPilotRecords(
  contexts: HermesPilotRecordContext[],
  phase: string,
): Record<string, unknown> {
  const resolved = contexts.map(resolveEffectiveHermesPilotRecord);
  const rawRecords = contexts.map((context) => context.record);
  const effectiveRecords = resolved.map((result) => result.record);
  const graded = effectiveRecords.filter((record) => record.verifier_graded === true);
  const passed = graded.filter((record) => record.accuracy === true).length;
  const failed = graded.filter((record) => record.accuracy === false).length;

  const totalCostUsd = rawRecords.reduce((sum, record) => sum + numeric(record.cost_usd), 0);
  return {
    phase,
    records: rawRecords.length,
    effective_statuses: countStatuses(effectiveRecords),
    effective_accuracy: {
      graded: graded.length,
      passed,
      failed,
      ungraded: rawRecords.length - graded.length,
      rate: graded.length > 0 ? passed / graded.length : null,
    },
    raw_statuses: countStatuses(rawRecords),
    regraded_records: resolved.filter((result) => result.regraded).length,
    total_cost_usd: Number(totalCostUsd.toFixed(12)),
  };
}
