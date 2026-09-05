import { describe, expect, it } from "vitest";
import type {
  StagehandMetrics,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import { StagehandMetricsAccumulator } from "../metrics.js";

const ACT_USAGE: StagehandResultUsage = {
  inputTokens: 10,
  outputTokens: 4,
  reasoningTokens: 2,
  cachedInputTokens: 3,
  inferenceTimeMs: 100,
};

const EXTRACT_USAGE: StagehandResultUsage = {
  inputTokens: 20,
  outputTokens: 8,
  reasoningTokens: 5,
  cachedInputTokens: 6,
  inferenceTimeMs: 200,
};

const OBSERVE_USAGE: StagehandResultUsage = {
  inputTokens: 30,
  outputTokens: 12,
  reasoningTokens: 7,
  cachedInputTokens: 9,
  inferenceTimeMs: 300,
};

const ZERO_USAGE: StagehandResultUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cachedInputTokens: 0,
  inferenceTimeMs: 0,
};

describe("StagehandMetricsAccumulator", () => {
  it("starts at zero and accumulates each operation into its bucket and the totals", () => {
    const metrics = new StagehandMetricsAccumulator();

    expect(metrics.snapshot()).toStrictEqual(emptyMetrics());

    metrics.record("act", ACT_USAGE);
    metrics.record("extract", EXTRACT_USAGE);
    metrics.record("observe", OBSERVE_USAGE);

    expect(metrics.snapshot()).toStrictEqual({
      actPromptTokens: 10,
      actCompletionTokens: 4,
      actReasoningTokens: 2,
      actCachedInputTokens: 3,
      actInferenceTimeMs: 100,
      extractPromptTokens: 20,
      extractCompletionTokens: 8,
      extractReasoningTokens: 5,
      extractCachedInputTokens: 6,
      extractInferenceTimeMs: 200,
      observePromptTokens: 30,
      observeCompletionTokens: 12,
      observeReasoningTokens: 7,
      observeCachedInputTokens: 9,
      observeInferenceTimeMs: 300,
      totalPromptTokens: 60,
      totalCompletionTokens: 24,
      totalReasoningTokens: 14,
      totalCachedInputTokens: 18,
      totalInferenceTimeMs: 600,
    });
  });

  it("keeps zero usage from changing counters and returns detached read-only snapshots", () => {
    const metrics = new StagehandMetricsAccumulator();
    metrics.record("act", ZERO_USAGE);

    const firstSnapshot = metrics.snapshot();
    firstSnapshot.totalPromptTokens = 999;

    expect(metrics.snapshot()).toStrictEqual(emptyMetrics());
    expect(metrics.snapshot()).not.toBe(metrics.snapshot());
  });

  it("resets accumulated usage for a new Stagehand instance", () => {
    const metrics = new StagehandMetricsAccumulator();
    metrics.record("act", ACT_USAGE);

    metrics.reset();

    expect(metrics.snapshot()).toStrictEqual(emptyMetrics());
  });
});

function emptyMetrics(): StagehandMetrics {
  return {
    actPromptTokens: 0,
    actCompletionTokens: 0,
    actReasoningTokens: 0,
    actCachedInputTokens: 0,
    actInferenceTimeMs: 0,
    extractPromptTokens: 0,
    extractCompletionTokens: 0,
    extractReasoningTokens: 0,
    extractCachedInputTokens: 0,
    extractInferenceTimeMs: 0,
    observePromptTokens: 0,
    observeCompletionTokens: 0,
    observeReasoningTokens: 0,
    observeCachedInputTokens: 0,
    observeInferenceTimeMs: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalReasoningTokens: 0,
    totalCachedInputTokens: 0,
    totalInferenceTimeMs: 0,
  };
}
