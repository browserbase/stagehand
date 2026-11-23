import { describe, expect, it } from "vitest";
import type { PriceMap } from "../../framework/costEstimate.js";
import type { BenchCaseRow } from "../../lib/braintrust-report.js";
import { caseCost, estimatedTokenCost } from "../../scripts/publish-braintrust-ui-data.js";

function benchCase(model: string | undefined, metrics: Record<string, number>): BenchCaseRow {
  return {
    key: "case",
    suite: "bench",
    taskName: "task",
    trial: 1,
    success: true,
    model,
    metrics,
  };
}

describe("leaderboard cost fallback", () => {
  // Every id the leaderboard used to price from its own table must still get a price.
  it.each([
    "anthropic/claude-sonnet-5",
    "claude-sonnet-5",
    "openai/gpt-5.6-sol",
    "gpt-5.6-sol",
    "openai/gpt-5.6-terra",
    "gpt-5.6-terra",
    "openai/gpt-5.6-luna",
    "gpt-5.6-luna",
    "xai/grok-4.5",
    "grok-4.5",
    "xai/grok-4.3",
    "grok-4.3",
    "anthropic/claude-opus-4-7",
    "claude-opus-4-7",
    "anthropic/claude-opus-4-6",
    "claude-opus-4-6",
    "anthropic/claude-opus-4-5",
    "claude-opus-4-5",
    "anthropic/claude-sonnet-4-6",
    "claude-sonnet-4-6",
    "anthropic/claude-sonnet-4-5",
    "claude-sonnet-4-5",
    "anthropic/claude-haiku-4-5",
    "claude-haiku-4-5",
    "openai/gpt-5.5",
    "gpt-5.5",
    "openai/gpt-5.4",
    "gpt-5.4",
    "openai/gpt-5.4-mini",
    "gpt-5.4-mini",
    "google/gemini-3-flash-preview",
    "gemini-3-flash-preview",
    "google/gemini-2.5-computer-use-preview-10-2025",
    "gemini-2.5-computer-use-preview-10-2025",
    "google/gemini-2.5-computer-use-preview",
    "gemini-2.5-computer-use-preview",
  ])("prices %s from pricing.json", (model) => {
    const cost = estimatedTokenCost(
      benchCase(model, { agent_input_tokens: 1_000_000, agent_output_tokens: 1_000 }),
    );
    expect(cost).toBeGreaterThan(0);
  });

  it("uses the catalog rates, not a second table", () => {
    // pricing.json: gpt-5.6-luna 0.2 / 0.02 / 1.2 USD per 1M tokens.
    const luna = benchCase("openai/gpt-5.6-luna", {
      agent_input_tokens: 1_000_000,
      agent_cached_input_tokens: 200_000,
      agent_output_tokens: 100_000,
    });
    expect(estimatedTokenCost(luna)).toBeCloseTo(0.16 + 0.004 + 0.12, 6);

    // pricing.json: claude-sonnet-5 2 / 10 USD per 1M tokens.
    const sonnet = benchCase("anthropic/claude-sonnet-5", {
      agent_input_tokens: 1_000_000,
      agent_output_tokens: 100_000,
    });
    expect(estimatedTokenCost(sonnet)).toBeCloseTo(2 + 1, 6);
  });

  it("reads the price map it is given", () => {
    const priceMap: PriceMap = {
      as_of: "2026-01-01",
      models: {
        "openai/example": {
          input_per_m: 1,
          cached_input_per_m: 0.5,
          output_per_m: 4,
          source: "fixture",
        },
      },
    };
    const row = benchCase("OpenAI/Example", {
      total_input_tokens: 2_000_000,
      total_cached_input_tokens: 1_000_000,
      total_output_tokens: 500_000,
    });
    expect(estimatedTokenCost(row, priceMap)).toBeCloseTo(1 + 0.5 + 2, 6);
    expect(caseCost(row, priceMap)).toBeCloseTo(3.5, 6);
  });

  it("does not bill a multi-step run at the long-context rate because of its total", () => {
    // 30 computer-use steps of 20K input tokens each: no single request is over
    // 200K, so every step bills at the base 1.25 / 10 rate, not 2.50 / 15.
    const run = benchCase("google/gemini-2.5-computer-use-preview-10-2025", {
      agent_input_tokens: 30 * 20_000,
      agent_output_tokens: 30 * 500,
    });
    expect(estimatedTokenCost(run)).toBeCloseTo(0.75 + 0.15, 6);
  });

  it("prefers a reported cost and leaves unknown models unpriced", () => {
    expect(
      caseCost(
        benchCase("openai/gpt-5.6-luna", {
          cost_usd: 0.42,
          agent_input_tokens: 1_000_000,
          agent_output_tokens: 1_000,
        }),
      ),
    ).toBe(0.42);
    expect(
      caseCost(
        benchCase("example/unknown-model", {
          agent_input_tokens: 1_000_000,
          agent_output_tokens: 1_000,
        }),
      ),
    ).toBeUndefined();
    expect(caseCost(benchCase("openai/gpt-5.6-luna", {}))).toBeUndefined();
  });
});
