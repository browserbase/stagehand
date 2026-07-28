/**
 * Performance metrics collector for core tier (deterministic) tasks.
 *
 * Tracks latency timers and custom numeric metrics. Produces summary
 * statistics for repeated samples while keeping single-sample metrics compact.
 */
import type { MetricsCollector } from "./types.js";

export function createMetricsCollector(): MetricsCollector {
  const data: Record<string, number[]> = {};

  function record(name: string, value: number): void {
    if (!data[name]) data[name] = [];
    data[name].push(value);
  }

  function startTimer(name: string): () => number {
    const start = performance.now();
    return () => {
      const duration = performance.now() - start;
      record(name, duration);
      return duration;
    };
  }

  function getAll(): Record<string, number[]> {
    return { ...data };
  }

  function percentile(sorted: number[], p: number): number {
    const idx = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, idx)];
  }

  function summarizeValues(values: number[]): Record<string, number> {
    const sorted = [...values].sort((a, b) => a - b);
    const singleValue = sorted[0];

    if (sorted.length === 1) {
      return {
        count: 1,
        value: singleValue,
      };
    }

    const sum = sorted.reduce((a, b) => a + b, 0);

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg: sum / sorted.length,
      p50: percentile(sorted, 50),
      p99: percentile(sorted, 99),
      count: sorted.length,
      value: singleValue,
    };
  }

  function getSummary(): Record<string, Record<string, number>> {
    const summary: Record<string, Record<string, number>> = {};

    for (const [name, values] of Object.entries(data)) {
      if (values.length === 0) continue;
      summary[name] = summarizeValues(values);
    }

    return summary;
  }

  return { startTimer, record, getAll, getSummary };
}
