import { describe, expect, it } from "vitest";
import {
  computeListCost,
  loadPriceMap,
  modelPriceCandidates,
  providerOf,
  resolveBilledCost,
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

const compute = (usage: ReturnType<typeof normalizeUsage>, model: string) =>
  computeListCost(usage, model, priceMap);

describe("computeListCost", () => {
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
    expect(compute(usage, "openai/gpt-5.4-mini")).toBe(0.86);
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
    expect(compute(usage, "anthropic/claude-sonnet-4-6")).toBe(2.1);
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
    expect(compute(usage, "openai/gpt-5.4-mini")).toBeCloseTo(0.10004, 6);
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
    expect(compute(base, "openai/gpt-5.4-mini")).toBe(4);
    expect(compute({ ...base, reasoning_in_output: false }, "openai/gpt-5.4-mini")).toBe(6);
  });

  it("returns nothing for null-price entries, unknown models and unreported usage", () => {
    const usage = normalizeUsage({
      harness: "claude_code",
      raw: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    });
    expect(compute(usage, "anthropic/claude-fable-5")).toBeUndefined();
    expect(compute(usage, "anthropic/claude-melon-lp-eap")).toBeUndefined();
    expect(computeListCost(usage, undefined, priceMap)).toBeUndefined();
    const unreported = normalizeUsage({
      harness: "cursor",
      raw: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(compute(unreported, "openai/gpt-5.4-mini")).toBeUndefined();
  });
});

describe("resolveBilledCost", () => {
  const usage = normalizeUsage({
    harness: "codex",
    raw: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
  });

  it("takes the harness-reported dollars first, naming the channel", () => {
    expect(
      resolveBilledCost({
        harness: "claude_code",
        model: "anthropic/claude-sonnet-4-6",
        usage,
        reportedCostUsd: 4.2,
        priceMap,
      }),
    ).toEqual({ cost_usd: 4.2, cost_source: "reported", billing_channel: "anthropic_api" });
    expect(
      resolveBilledCost({
        harness: "eve",
        model: "zai/glm-5.3",
        usage,
        reportedCostUsd: 0.01,
        priceMap,
      }).billing_channel,
    ).toBe("ai_gateway");
    expect(
      resolveBilledCost({
        harness: "pi",
        model: "openai/gpt-5.4-mini",
        usage,
        reportedCostUsd: 0.5,
        priceMap,
      }).billing_channel,
    ).toBe("pi_catalog");
    expect(
      resolveBilledCost({
        harness: "fx",
        model: "zai/glm-5.3",
        usage,
        reportedCostUsd: 0.02,
        priceMap,
      }).billing_channel,
    ).toBe("fx_gateway");
    // A reported figure wins even for a priced model on a direct-API harness.
    expect(
      resolveBilledCost({
        harness: "pi",
        model: "openai/gpt-5.4-mini",
        usage,
        reportedCostUsd: 1.3,
        priceMap,
      }),
    ).toMatchObject({ cost_usd: 1.3, cost_source: "reported" });
  });

  it("computes direct-provider harnesses at list price when nothing was reported", () => {
    for (const harness of ["codex", "mastra", "deepagents", "eve", "pi"]) {
      expect(
        resolveBilledCost({ harness, model: "openai/gpt-5.4-mini", usage, priceMap }),
        harness,
      ).toEqual({
        cost_usd: 1,
        cost_source: "computed",
        billing_channel: "openai_api",
      });
    }
    expect(
      resolveBilledCost({ harness: "codex", model: "codex/default", usage, priceMap })
        .billing_channel,
    ).toBe("openai_api");
    expect(
      resolveBilledCost({ harness: "mastra", model: "xai/grok-4.5", usage, priceMap }),
    ).toMatchObject({
      cost_usd: 2,
      cost_source: "computed",
      billing_channel: "xai_api",
    });
    expect(
      resolveBilledCost({
        harness: "deepagents",
        model: "anthropic/claude-sonnet-4-6",
        usage,
        priceMap,
      }).billing_channel,
    ).toBe("anthropic_api");
  });

  it("is unavailable, never zero, for subscription cells, unpriced models and unreported usage", () => {
    expect(
      resolveBilledCost({ harness: "cursor", model: "openai/gpt-5.4-mini", usage, priceMap }),
    ).toEqual({ cost_source: "unavailable", billing_channel: "subscription" });
    expect(
      resolveBilledCost({
        harness: "claude_code",
        model: "anthropic/claude-sonnet-4-6",
        usage,
        priceMap,
      }),
    ).toEqual({ cost_source: "unavailable", billing_channel: "subscription" });
    expect(resolveBilledCost({ harness: "fx", model: "zai/glm-5.3", usage, priceMap })).toEqual({
      cost_source: "unavailable",
      billing_channel: "zai_api",
    });
    expect(
      resolveBilledCost({ harness: "codex", model: "openai/gpt-5.6-luna", usage, priceMap }),
    ).toEqual({ cost_source: "unavailable", billing_channel: "openai_api" });
    const unreported = normalizeUsage({
      harness: "codex",
      raw: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reported: false },
    });
    expect(
      resolveBilledCost({
        harness: "codex",
        model: "openai/gpt-5.4-mini",
        usage: unreported,
        priceMap,
      }),
    ).toEqual({ cost_source: "unavailable", billing_channel: "openai_api" });
    // A non-finite report is no report.
    expect(
      resolveBilledCost({
        harness: "pi",
        model: "openai/gpt-5.4-mini",
        usage,
        reportedCostUsd: Number.NaN,
        priceMap,
      }).cost_source,
    ).toBe("computed");
  });

  it("derives the provider from the configured id", () => {
    expect(providerOf("gateway/openai/gpt-5.4-mini")).toBe("openai");
    expect(providerOf("codex/default")).toBe("openai");
    expect(providerOf("xai/grok-4.5")).toBe("xai");
    expect(providerOf("gpt-5.4-mini")).toBeUndefined();
    expect(providerOf(undefined)).toBeUndefined();
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
