/**
 * Performance metrics collector for core tier (deterministic) tasks.
 *
 * Tracks latency timers and custom numeric metrics. Produces summary
 * statistics (min, max, avg, p50, p99) for Braintrust reporting.
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

  function getSummary(): Record<
    string,
    { min: number; max: number; avg: number; p50: number; p99: number; count: number }
  > {
    const summary: Record<
      string,
      { min: number; max: number; avg: number; p50: number; p99: number; count: number }
    > = {};

    for (const [name, values] of Object.entries(data)) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      const sum = sorted.reduce((a, b) => a + b, 0);
      summary[name] = {
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: sum / sorted.length,
        p50: percentile(sorted, 50),
        p99: percentile(sorted, 99),
        count: sorted.length,
      };
    }

    return summary;
  }

  return { startTimer, record, getAll, getSummary };
}
