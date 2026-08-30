import type { ProbeEvidence } from "stagehand-v3";

/** A probe observation captured after the Nth run-tool execution (0-based). */
export interface StepObservation {
  runIndex: number;
  evidence: ProbeEvidence;
}

const OBSERVATIONS_ENV = "EVAL_HARNESS_OBSERVATIONS";
const OBSERVATION_TIMEOUT_ENV = "EVAL_OBSERVATION_TIMEOUT_MS";
const DEFAULT_OBSERVATION_TIMEOUT_MS = 10_000;

/**
 * Whether this run collects per-step observations. Sampling is a run-level
 * decision: batch tooling sets EVAL_HARNESS_OBSERVATIONS=none on runs it
 * excludes from evidence collection; the default is to observe.
 */
export function harnessObservationsEnabled(): boolean {
  return (process.env[OBSERVATIONS_ENV] ?? "all") !== "none";
}

export function createObservationRecorder(
  capture?: () => Promise<ProbeEvidence>,
): ObservationRecorder | undefined {
  if (!capture || !harnessObservationsEnabled()) return undefined;
  return new ObservationRecorder(capture);
}

/**
 * Buffers per-step probe observations for an external-harness run. Each
 * record() consumes one run index (matching the harness's Nth run-tool
 * execution); a failed capture leaves a gap at its index rather than
 * shifting later observations onto the wrong step.
 */
export class ObservationRecorder {
  private readonly observations: StepObservation[] = [];
  private readonly pending = new Set<Promise<void>>();
  private runIndex = 0;

  constructor(private readonly capture: () => Promise<ProbeEvidence>) {}

  async record(): Promise<void> {
    const runIndex = this.runIndex++;
    const attempt = (async () => {
      try {
        const evidence = await withTimeout(this.capture(), observationTimeoutMs());
        if (evidence.screenshot || evidence.url || evidence.ariaTree) {
          this.observations.push({ runIndex, evidence });
        }
      } catch {
        // best-effort only — a failed probe must never fail the run tool
      }
    })();
    this.pending.add(attempt);
    try {
      await attempt;
    } finally {
      this.pending.delete(attempt);
    }
  }

  /**
   * Waits for in-flight captures. Callers that fire record() without
   * awaiting it (MCP tool-result streams) must settle() before drain(), or
   * the last observations of a run race the drain and silently go missing.
   */
  async settle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.allSettled([...this.pending]);
    }
  }

  drain(): StepObservation[] {
    return this.observations.splice(0);
  }
}

function observationTimeoutMs(): number {
  const parsed = Number.parseInt(process.env[OBSERVATION_TIMEOUT_ENV] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_OBSERVATION_TIMEOUT_MS;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`observation timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
