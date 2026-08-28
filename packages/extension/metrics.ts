import type { StagehandMetrics, StagehandResultUsage } from "../protocol/types.js";

type StagehandMetricMethod = "act" | "extract" | "observe";

const EMPTY_METRICS: StagehandMetrics = {
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

export class StagehandMetricsAccumulator {
  private readonly values: StagehandMetrics = { ...EMPTY_METRICS };

  record(method: StagehandMetricMethod, usage: StagehandResultUsage): void {
    switch (method) {
      case "act":
        this.values.actPromptTokens += usage.inputTokens;
        this.values.actCompletionTokens += usage.outputTokens;
        this.values.actReasoningTokens += usage.reasoningTokens;
        this.values.actCachedInputTokens += usage.cachedInputTokens;
        this.values.actInferenceTimeMs += usage.inferenceTimeMs;
        break;
      case "extract":
        this.values.extractPromptTokens += usage.inputTokens;
        this.values.extractCompletionTokens += usage.outputTokens;
        this.values.extractReasoningTokens += usage.reasoningTokens;
        this.values.extractCachedInputTokens += usage.cachedInputTokens;
        this.values.extractInferenceTimeMs += usage.inferenceTimeMs;
        break;
      case "observe":
        this.values.observePromptTokens += usage.inputTokens;
        this.values.observeCompletionTokens += usage.outputTokens;
        this.values.observeReasoningTokens += usage.reasoningTokens;
        this.values.observeCachedInputTokens += usage.cachedInputTokens;
        this.values.observeInferenceTimeMs += usage.inferenceTimeMs;
        break;
    }

    this.values.totalPromptTokens += usage.inputTokens;
    this.values.totalCompletionTokens += usage.outputTokens;
    this.values.totalReasoningTokens += usage.reasoningTokens;
    this.values.totalCachedInputTokens += usage.cachedInputTokens;
    this.values.totalInferenceTimeMs += usage.inferenceTimeMs;
  }

  snapshot(): StagehandMetrics {
    return { ...this.values };
  }

  reset(): void {
    Object.assign(this.values, EMPTY_METRICS);
  }
}
