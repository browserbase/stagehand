import type { ModelPrice } from "./pricing.ts";

export type RunMetrics = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  cacheWriteInputTokens: number;
  reasoningTokens: number;
  costUsd: number;
  durationMs: number;
  llmCalls: number;
  success: boolean;
  error?: string;
};

export type TimelineStep = {
  // Seconds from the start of the recording.
  t: number;
  durationMs: number;
  // act/extract/observe for the script lane; MCP tool names for agent lanes.
  kind: string;
  instruction: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  cache: string;
  cacheMissReason?: string;
};

export type RunSummary = {
  // Median over successful runs; over all runs only when none succeeded.
  median: Omit<RunMetrics, "success" | "error">;
  medianOf: "successful" | "all";
  successRate: number;
  runs: RunMetrics[];
};

// Consumed by stagehand.dev/showcase through its sync script. Bump
// schemaVersion on any breaking change so the website can reject stale files.
export type ShowcaseResults = {
  schemaVersion: 2;
  slug: string;
  ranAt: string;
  stagehandVersion: string;
  playwrightMcpVersion: string;
  model: string;
  price: ModelPrice;
  startUrl: string;
  goal: string;
  output: unknown;
  timeline: TimelineStep[];
  video: { file: string; poster: string } | null;
  snippet: string;
  featuredLane: "codeMode" | "script";
  runs: {
    codeMode: RunSummary | null;
    playwrightMcp: RunSummary | null;
    script: RunSummary | null;
    scriptCached: RunSummary | null;
  };
};

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarize(runs: RunMetrics[]): RunSummary {
  const successful = runs.filter((run) => run.success);
  const pool = successful.length > 0 ? successful : runs;
  const of = (key: keyof RunSummary["median"]) => median(pool.map((run) => run[key]));
  return {
    median: {
      inputTokens: of("inputTokens"),
      outputTokens: of("outputTokens"),
      cachedInputTokens: of("cachedInputTokens"),
      cacheWriteInputTokens: of("cacheWriteInputTokens"),
      reasoningTokens: of("reasoningTokens"),
      costUsd: of("costUsd"),
      durationMs: of("durationMs"),
      llmCalls: of("llmCalls"),
    },
    medianOf: successful.length > 0 ? "successful" : "all",
    successRate: runs.length ? successful.length / runs.length : 0,
    runs,
  };
}
