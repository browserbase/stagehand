import type { MetricsCollector } from "./types.js";

export function createMetricsCollector(): MetricsCollector {
  const data = new Map<string, number[]>();

  function record(name: string, value: number): void {
    if (!Number.isFinite(value)) return;
    let list = data.get(name);
    if (!list) {
      list = [];
      data.set(name, list);
    }
    list.push(value);
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
    return Object.fromEntries(Array.from(data.entries(), ([name, values]) => [name, [...values]]));
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

    const avg = sorted.reduce(
      (mean, value, index) => mean * (index / (index + 1)) + value / (index + 1),
      0,
    );

    return {
      min: sorted[0],
      max: sorted[sorted.length - 1],
      avg,
      p50: percentile(sorted, 50),
      p99: percentile(sorted, 99),
      count: sorted.length,
      value: singleValue,
    };
  }

  function getSummary(): Record<string, Record<string, number>> {
    const entries: Array<[string, Record<string, number>]> = [];

    for (const [name, values] of data.entries()) {
      if (values.length === 0) continue;
      entries.push([name, summarizeValues(values)]);
    }

    return Object.fromEntries(entries);
  }

  return { startTimer, record, getAll, getSummary };
}
