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
  it("keeps Astra estimates unavailable until per-request context tiers are represented", () => {
    const usage = normalizeUsage({
      harness: "codex",
      raw: {
        inputTokens: 300_000,
        outputTokens: 1000,
        totalTokens: 301_000,
      },
    });
    expect(computeListCost(usage, "openai/gpt-6-astra", loadPriceMap())).toBeUndefined();
  });

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

  it("rejects malformed or negative rates, including optional cache writes, and overflow", () => {
    const usage = normalizeUsage({
      harness: "pi",
      raw: { inputTokens: 1, cacheCreationInputTokens: 1, outputTokens: 1, totalTokens: 3 },
    });
    for (const key of [
      "input_per_m",
      "cached_input_per_m",
      "cache_write_input_per_m",
      "output_per_m",
    ] as const) {
      for (const rate of [-1, NaN, Infinity, "2"]) {
        const malformed = {
          ...priceMap,
          models: {
            "openai/gpt-5.4-mini": { ...priceMap.models["openai/gpt-5.4-mini"], [key]: rate },
          },
        } as PriceMap;
        expect(
          computeListCost(usage, "openai/gpt-5.4-mini", malformed),
          `${key}=${rate}`,
        ).toBeUndefined();
        expect(
          resolveBilledCost({
            harness: "pi",
            model: "openai/gpt-5.4-mini",
            usage,
            priceMap: malformed,
          }).cost_source,
        ).toBe("unavailable");
      }
    }
    const overflow = { ...usage, input_uncached: Number.MAX_VALUE };
    expect(computeListCost(overflow, "anthropic/claude-sonnet-4.6", priceMap)).toBeUndefined();
  });

  it("returns nothing for null-price entries, unknown models and unreported usage", () => {
    const usage = normalizeUsage({
      harness: "claude_code",
      raw: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
    });
    expect(compute(usage, "anthropic/claude-fable-5")).toBeUndefined();
    expect(compute(usage, "example/unknown-model")).toBeUndefined();
    expect(computeListCost(usage, undefined, priceMap)).toBeUndefined();
    const unreported = normalizeUsage({
      harness: "cursor",
      raw: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reported: false },
    });
    expect(compute(unreported, "openai/gpt-5.4-mini")).toBeUndefined();
  });
});

describe("resolveBilledCost", () => {
  it.each([
    ["claude_cua", "anthropic/claude-sonnet-4.6", "anthropic_api"],
    ["gemini_cua", "google/gemini-fixture", "google_api"],
  ])(
    "estimates native %s provider usage with dated price provenance",
    (harness, model, channel) => {
      const nativeMap: PriceMap = {
        as_of: "2026-08-31",
        models: {
          [model]: {
            input_per_m: 1,
            cached_input_per_m: 0.1,
            output_per_m: 4,
            source: "fixture price source",
          },
        },
      };
      const nativeUsage = normalizeUsage({
        harness,
        raw: { inputTokens: 100, outputTokens: 10, totalTokens: 110, reported: true },
      });
      expect(
        resolveBilledCost({ harness, model, usage: nativeUsage, priceMap: nativeMap }),
      ).toMatchObject({
        cost_source: "computed",
        billing_channel: channel,
        cost_pricing: { as_of: "2026-08-31", model, source: "fixture price source" },
      });
      const missing = normalizeUsage({
        harness,
        raw: { inputTokens: 0, outputTokens: 0, totalTokens: 0, reported: false },
      });
      expect(resolveBilledCost({ harness, model, usage: missing, priceMap: nativeMap })).toEqual({
        cost_source: "unavailable",
        billing_channel: channel,
      });
    },
  );
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
        cost_pricing: { as_of: "2026-08-31", model: "openai/gpt-5.4-mini", source: "test" },
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
      billing_channel: "fx_gateway",
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

  it("retains the dated matched model/source for aliases and omits pricing on reported or unavailable cost", () => {
    const computed = resolveBilledCost({
      harness: "mastra",
      model: "xai/grok-4.5",
      usage,
      priceMap,
    });
    expect(computed.cost_pricing).toEqual({
      as_of: "2026-08-31",
      model: "spacexai/grok-4.5",
      source: "test",
    });
    expect(
      resolveBilledCost({
        harness: "pi",
        model: "openai/gpt-5.4-mini",
        usage,
        reportedCostUsd: 0,
        priceMap,
      }),
    ).toEqual({ cost_usd: 0, cost_source: "reported", billing_channel: "pi_catalog" });
    expect(
      resolveBilledCost({ harness: "cursor", model: "openai/gpt-5.4-mini", usage, priceMap }),
    ).not.toHaveProperty("cost_pricing");
    expect(
      resolveBilledCost({
        harness: "pi",
        model: "openai/gpt-5.4-mini",
        usage,
        reportedCostUsd: -1,
        priceMap,
      }).cost_source,
    ).toBe("computed");
  });

  it.each(["eve", "mastra", "pi"])(
    "keeps missing %s usage unavailable and explicit zero usage priceable",
    (harness) => {
      const empty = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
      const unknown = normalizeUsage({ harness, raw: empty });
      expect(
        resolveBilledCost({ harness, model: "openai/gpt-5.4-mini", usage: unknown, priceMap }),
      ).toEqual({ cost_source: "unavailable", billing_channel: "openai_api" });
      const reportedZero = normalizeUsage({ harness, raw: { ...empty, reported: true } });
      expect(
        resolveBilledCost({ harness, model: "openai/gpt-5.4-mini", usage: reportedZero, priceMap }),
      ).toMatchObject({ cost_source: "computed", cost_usd: 0 });
    },
  );

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
  it("prices the curated set", () => {
    const shipped = loadPriceMap();
    expect(shipped.as_of).toMatch(/^\d{4}-\d{2}-\d{2}$/u);
    expect(resolveModelPrice("openai/gpt-5.4-mini", shipped)).toBeDefined();
    expect(resolveModelPrice("anthropic/claude-sonnet-4-6", shipped)).toBeDefined();
    expect(resolveModelPrice("xai/grok-4.5", shipped)).toBeDefined();
    // gpt-5.6 luna/terra/sol are on the public OpenAI price list (2026-09-02).
    for (const model of ["openai/gpt-5.6-luna", "openai/gpt-5.6-terra", "openai/gpt-5.6-sol"]) {
      expect(shipped.models[model]?.source, model).toMatch(/developers\.openai\.com/u);
      expect(resolveModelPrice(model, shipped), model).toBeDefined();
    }
    // Fable 5.1 cache hits are 0.025x base input (other Anthropic models 0.1x).
    expect(shipped.models["anthropic/claude-fable-5-1"]).toMatchObject({
      input_per_m: 10,
      cached_input_per_m: 0.25,
      output_per_m: 50,
      cache_write_input_per_m: 12.5,
    });
  });
});
