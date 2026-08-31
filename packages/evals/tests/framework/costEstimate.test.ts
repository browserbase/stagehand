import { describe, expect, it } from "vitest";
import {
  estimateCost,
  loadPriceMap,
  modelPriceCandidates,
  resolveModelPrice,
  type PriceMap,
} from "../../framework/costEstimate.js";
import { normalizeUsage } from "../../framework/usageNormalization.js";

const priceMap: PriceMap = {
  as_of: "2026-08-31",
  models: {
    "openai/gpt-5.4-mini": {
      input_per_m: 1,
      cached_input_per_m: 0.1,
      output_per_m: 4,
      source: "test",
    },
    "anthropic/claude-sonnet-4.6": {
      input_per_m: 3,
      cached_input_per_m: 0.3,
      cache_write_input_per_m: 3.75,
      output_per_m: 15,
      source: "test",
    },
    "spacexai/grok-4.5": {
      input_per_m: 2,
      cached_input_per_m: 0.3,
      output_per_m: 6,
      source: "test",
    },
    "google/gemini-3-flash": {
      input_per_m: 0.5,
      cached_input_per_m: 0.05,
      output_per_m: 3,
      source: "test",
    },
    "anthropic/claude-fable-5": {
      input_per_m: null,
      cached_input_per_m: null,
      output_per_m: null,
      source: "needs owner input",
    },
  },
};

describe("estimateCost", () => {
  it("prices the OpenAI subset convention: uncached at input, cached at cache rate, reasoning inside output", () => {
    const usage = normalizeUsage({
      harness: "codex",
      raw: {
        inputTokens: 1_000_000,
        cachedInputTokens: 600_000,
        outputTokens: 100_000,
        reasoningOutputTokens: 40_000,
        totalTokens: 1_100_000,
      },
    });
    // 400k·1 + 600k·0.1 + 100k·4 = 0.4 + 0.06 + 0.4
    expect(estimateCost(usage, "openai/gpt-5.4-mini", priceMap)).toEqual({
      cost_usd_estimated: 0.86,
      cost_source: "estimated",
      priced_with: "openai/gpt-5.4-mini",
      prices_as_of: "2026-08-31",
    });
  });

  it("prices the Anthropic separate convention with cache writes at the write rate", () => {
    const usage = normalizeUsage({
      harness: "claude_code",
      raw: {
        inputTokens: 100_000,
        cachedInputTokens: 1_000_000,
        cacheCreationInputTokens: 200_000,
        outputTokens: 50_000,
        totalTokens: 1_350_000,
      },
    });
    // 100k·3 + 1M·0.3 + 200k·3.75 + 50k·15 = 0.3 + 0.3 + 0.75 + 0.75
    expect(estimateCost(usage, "anthropic/claude-sonnet-4-6", priceMap)).toMatchObject({
      cost_usd_estimated: 2.1,
      priced_with: "anthropic/claude-sonnet-4.6",
    });
  });

  it("prices pi's uncached-only input plus its separate cache buckets", () => {
    const usage = normalizeUsage({
      harness: "pi",
      raw: {
        inputTokens: 40,
        cachedInputTokens: 1_000_000,
        cacheCreationInputTokens: 0,
        outputTokens: 0,
        totalTokens: 1_000_040,
      },
    });
    const estimate = estimateCost(usage, "openai/gpt-5.4-mini", priceMap);
    expect(estimate.cost_usd_estimated).toBeCloseTo(0.10004, 6);
  });

  it("bills reasoning at the output rate only when it is reported outside output", () => {
    const base = normalizeUsage({
      harness: "codex",
      raw: {
        inputTokens: 0,
        outputTokens: 1_000_000,
        reasoningOutputTokens: 500_000,
        totalTokens: 0,
      },
    });
    expect(estimateCost(base, "openai/gpt-5.4-mini", priceMap).cost_usd_estimated).toBe(4);
    expect(
      estimateCost({ ...base, reasoning_in_output: false }, "openai/gpt-5.4-mini", priceMap)
        .cost_usd_estimated,
    ).toBe(6);
  });

  it("reports unpriced for null-price entries and unknown models without inventing zero", () => {
    const usage = normalizeUsage({
      harness: "claude_code",
      raw: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    });
    expect(estimateCost(usage, "anthropic/claude-fable-5", priceMap)).toEqual({
      cost_source: "unpriced",
    });
    expect(estimateCost(usage, "anthropic/claude-melon-lp-eap", priceMap)).toEqual({
      cost_source: "unpriced",
    });
    expect(estimateCost(usage, undefined, priceMap)).toEqual({ cost_source: "unpriced" });
  });

  it("reports no_usage when the harness never reported tokens", () => {
    const usage = normalizeUsage({
      harness: "cursor",
      raw: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(estimateCost(usage, "openai/gpt-5.4-mini", priceMap)).toEqual({
      cost_source: "no_usage",
    });
  });
});

describe("model alias resolution", () => {
  it.each([
    ["gateway/openai/gpt-5.4-mini", "openai/gpt-5.4-mini"],
    ["gateway/gpt-5.4-mini", "openai/gpt-5.4-mini"],
    ["codex/default", "openai/gpt-5.4-mini"],
    ["gpt-5.4-mini", "openai/gpt-5.4-mini"],
    ["anthropic/claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"],
    ["claude-sonnet-4-6-eap", "anthropic/claude-sonnet-4.6"],
    ["anthropic/claude-sonnet-4.6-20260101", "anthropic/claude-sonnet-4.6"],
    ["xai/grok-4.5", "spacexai/grok-4.5"],
    ["grok-4.5", "spacexai/grok-4.5"],
    ["google/gemini-3-flash-preview", "google/gemini-3-flash"],
  ])("resolves %s to %s", (model, expected) => {
    expect(resolveModelPrice(model, priceMap)?.key).toBe(expected);
  });

  it("never borrows a sibling model's price", () => {
    expect(resolveModelPrice("openai/gpt-5.4", priceMap)).toBeUndefined();
    expect(resolveModelPrice("anthropic/claude-sonnet-4", priceMap)).toBeUndefined();
    expect(resolveModelPrice("fx/default", priceMap)).toBeUndefined();
  });

  it("does not match a bare name carried by several providers", () => {
    const ambiguous: PriceMap = {
      as_of: "x",
      models: {
        "a/model-1": { input_per_m: 1, cached_input_per_m: 1, output_per_m: 1, source: "t" },
        "b/model-1": { input_per_m: 2, cached_input_per_m: 2, output_per_m: 2, source: "t" },
      },
    };
    expect(resolveModelPrice("model-1", ambiguous)).toBeUndefined();
    expect(resolveModelPrice("b/model-1", ambiguous)?.key).toBe("b/model-1");
  });

  it("orders candidates from the exact id to the bare name", () => {
    expect(modelPriceCandidates("gateway/xai/grok-4-5")).toEqual([
      "xai/grok-4-5",
      "spacexai/grok-4-5",
      "x-ai/grok-4-5",
      "xai/grok-4.5",
      "spacexai/grok-4.5",
      "x-ai/grok-4.5",
      "grok-4-5",
      "grok-4.5",
    ]);
  });
});

describe("shipped price map", () => {
  it("prices the curated set and leaves EAP models unpriced", () => {
    const shipped = loadPriceMap();
    expect(shipped.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(resolveModelPrice("openai/gpt-5.4-mini", shipped)).toBeDefined();
    expect(resolveModelPrice("anthropic/claude-sonnet-4-6", shipped)).toBeDefined();
    expect(resolveModelPrice("xai/grok-4.5", shipped)).toBeDefined();
    for (const eap of [
      "openai/gpt-5.6-luna",
      "anthropic/claude-fable-5",
      "anthropic/claude-melon",
    ]) {
      expect(shipped.models[eap]?.source, eap).toBe("needs owner input");
      expect(resolveModelPrice(eap, shipped), eap).toBeUndefined();
    }
  });
});
