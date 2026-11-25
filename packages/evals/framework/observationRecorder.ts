import type { ProbeEvidence } from "stagehand-v3";

export interface StepObservation {
  runIndex: number;
  toolCallId?: string;
  evidence: ProbeEvidence;
}

const OBSERVATIONS_ENV = "EVAL_HARNESS_OBSERVATIONS";
const OBSERVATION_TIMEOUT_ENV = "EVAL_OBSERVATION_TIMEOUT_MS";
const DEFAULT_OBSERVATION_TIMEOUT_MS = 10_000;

export function harnessObservationsEnabled(): boolean {
  return (process.env[OBSERVATIONS_ENV] ?? "all") !== "none";
}

export class ObservationRecorder {
  private readonly observations: StepObservation[] = [];
  private readonly pending = new Set<Promise<void>>();
  private runIndex = 0;

  constructor(private readonly capture: () => Promise<ProbeEvidence>) {}

  async record(toolCallId?: string): Promise<void> {
    const runIndex = this.runIndex++;
    const attempt = (async () => {
      try {
        const evidence = await withTimeout(this.capture(), observationTimeoutMs());
        if (evidence.screenshot || evidence.url || evidence.ariaTree) {
          this.observations.push({ runIndex, evidence, ...(toolCallId && { toolCallId }) });
        }
      } catch {}
    })();
    this.pending.add(attempt);
    try {
      await attempt;
    } finally {
      this.pending.delete(attempt);
    }
  }

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
