import { describe, expect, it, vi } from "vitest";
import { V3 } from "../../lib/v3/v3";
import { V3FunctionName } from "../../lib/v3/types/public/methods";
import type { StagehandMetrics } from "../../lib/v3/types/public/metrics";

type TestStagehand = V3 & Record<string, unknown>;

function createEmptyMetrics(): StagehandMetrics {
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
    agentPromptTokens: 0,
    agentCompletionTokens: 0,
    agentReasoningTokens: 0,
    agentCachedInputTokens: 0,
    agentInferenceTimeMs: 0,
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalReasoningTokens: 0,
    totalCachedInputTokens: 0,
    totalInferenceTimeMs: 0,
  };
}

describe("agent metrics accounting", () => {
  it("merges API replay metrics with a local agent usage fallback only", async () => {
    const remoteMetrics: StagehandMetrics = {
      ...createEmptyMetrics(),
      actPromptTokens: 40,
      actCompletionTokens: 6,
      actReasoningTokens: 2,
      actCachedInputTokens: 1,
      actInferenceTimeMs: 300,
      extractPromptTokens: 10,
      extractCompletionTokens: 3,
      extractReasoningTokens: 1,
      extractCachedInputTokens: 2,
      extractInferenceTimeMs: 120,
      observePromptTokens: 8,
      observeCompletionTokens: 2,
      observeReasoningTokens: 1,
      observeCachedInputTokens: 0,
      observeInferenceTimeMs: 90,
      agentPromptTokens: 5,
      agentCompletionTokens: 1,
      agentReasoningTokens: 1,
      agentCachedInputTokens: 0,
      agentInferenceTimeMs: 30,
      totalPromptTokens: 63,
      totalCompletionTokens: 12,
      totalReasoningTokens: 5,
      totalCachedInputTokens: 3,
      totalInferenceTimeMs: 540,
    };

    const stagehand = Object.create(V3.prototype) as TestStagehand;
    const mutableStagehand = stagehand as Record<string, unknown>;

    mutableStagehand["apiClient"] = {
      getReplayMetrics: vi.fn().mockResolvedValue(remoteMetrics),
    };
    mutableStagehand["stagehandMetrics"] = createEmptyMetrics();

    stagehand.updateMetrics(V3FunctionName.AGENT, 25, 4, 3, 2, 180);

    const metrics = await stagehand.metrics;

    expect(metrics.actPromptTokens).toBe(40);
    expect(metrics.extractPromptTokens).toBe(10);
    expect(metrics.observePromptTokens).toBe(8);
    expect(metrics.agentPromptTokens).toBe(25);
    expect(metrics.agentCompletionTokens).toBe(4);
    expect(metrics.agentReasoningTokens).toBe(3);
    expect(metrics.agentCachedInputTokens).toBe(2);
    expect(metrics.agentInferenceTimeMs).toBe(180);
    expect(metrics.totalPromptTokens).toBe(83);
    expect(metrics.totalCompletionTokens).toBe(15);
    expect(metrics.totalReasoningTokens).toBe(7);
    expect(metrics.totalCachedInputTokens).toBe(5);
    expect(metrics.totalInferenceTimeMs).toBe(690);
  });

  it("records returned agent usage into local metrics totals", () => {
    const stagehand = Object.create(V3.prototype) as TestStagehand;
    const mutableStagehand = stagehand as Record<string, unknown>;

    mutableStagehand["stagehandMetrics"] = createEmptyMetrics();

    const updateAgentMetricsFromUsage = stagehand[
      "updateAgentMetricsFromUsage"
    ] as (usage?: {
      input_tokens: number;
      output_tokens: number;
      reasoning_tokens?: number;
      cached_input_tokens?: number;
      inference_time_ms: number;
    }) => void;

    updateAgentMetricsFromUsage.call(stagehand, {
      input_tokens: 12,
      output_tokens: 5,
      reasoning_tokens: 7,
      cached_input_tokens: 3,
      inference_time_ms: 220,
    });

    const metrics = stagehand["stagehandMetrics"] as StagehandMetrics;

    expect(metrics.agentPromptTokens).toBe(12);
    expect(metrics.agentCompletionTokens).toBe(5);
    expect(metrics.agentReasoningTokens).toBe(7);
    expect(metrics.agentCachedInputTokens).toBe(3);
    expect(metrics.agentInferenceTimeMs).toBe(220);
    expect(metrics.totalPromptTokens).toBe(12);
    expect(metrics.totalCompletionTokens).toBe(5);
    expect(metrics.totalReasoningTokens).toBe(7);
    expect(metrics.totalCachedInputTokens).toBe(3);
    expect(metrics.totalInferenceTimeMs).toBe(220);
  });
});
