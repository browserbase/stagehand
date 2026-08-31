import { describe, expect, it } from "vitest";
import {
  formatNormalizedUsage,
  normalizeUsage,
  usageConventionFor,
} from "../../framework/usageNormalization.js";

describe("normalizeUsage", () => {
  it("treats OpenAI-style cached tokens as a subset of input (codex, mastra, eve, deepagents, fx)", () => {
    for (const harness of ["codex", "mastra", "eve", "deepagents", "fx"]) {
      const usage = normalizeUsage({
        harness,
        raw: {
          inputTokens: 1000,
          cachedInputTokens: 600,
          outputTokens: 200,
          reasoningOutputTokens: 50,
          totalTokens: 1200,
        },
      });
      expect(usage, harness).toEqual({
        input_total: 1000,
        input_cached: 600,
        input_cache_write: 0,
        input_uncached: 400,
        output: 200,
        reasoning: 50,
        reasoning_in_output: true,
        convention: "openai_cached_subset",
      });
    }
  });

  it("keeps cache writes inside the total for the subset convention (AI SDK anthropic via eve)", () => {
    const usage = normalizeUsage({
      harness: "eve",
      raw: {
        inputTokens: 1000,
        cachedInputTokens: 600,
        cacheCreationInputTokens: 100,
        outputTokens: 10,
        totalTokens: 1010,
      },
    });
    expect(usage).toMatchObject({
      input_total: 1000,
      input_cached: 600,
      input_cache_write: 100,
      input_uncached: 300,
    });
  });

  it("never lets a cached count larger than input go negative", () => {
    const usage = normalizeUsage({
      harness: "codex",
      raw: { inputTokens: 100, cachedInputTokens: 150, outputTokens: 1, totalTokens: 101 },
    });
    expect(usage).toMatchObject({ input_total: 100, input_cached: 100, input_uncached: 0 });
  });

  it("adds Anthropic cache reads and writes on top of input_tokens (claude_code)", () => {
    const usage = normalizeUsage({
      harness: "claude_code",
      raw: {
        inputTokens: 40,
        cachedInputTokens: 127_000,
        cacheCreationInputTokens: 3_000,
        outputTokens: 900,
        totalTokens: 130_940,
      },
    });
    expect(usage).toEqual({
      input_total: 130_040,
      input_cached: 127_000,
      input_cache_write: 3_000,
      input_uncached: 40,
      output: 900,
      reasoning: 0,
      reasoning_in_output: true,
      convention: "anthropic_cache_separate",
    });
  });

  it("treats pi input as the uncached remainder (input_tokens=40 with 127k cached observed)", () => {
    const usage = normalizeUsage({
      harness: "pi",
      raw: {
        inputTokens: 40,
        cachedInputTokens: 127_000,
        cacheCreationInputTokens: 0,
        outputTokens: 500,
        reasoningOutputTokens: 120,
        totalTokens: 127_540,
      },
    });
    expect(usage).toMatchObject({
      input_total: 127_040,
      input_cached: 127_000,
      input_uncached: 40,
      output: 500,
      reasoning: 120,
      convention: "uncached_only",
    });
  });

  it("marks cursor usage as unreported instead of zero", () => {
    const usage = normalizeUsage({
      harness: "cursor",
      raw: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    });
    expect(usage.convention).toBe("unreported");
    expect(formatNormalizedUsage(usage)).toBe("in=? out=? (usage unreported)");
  });

  it("falls back to the subset convention for unregistered harnesses", () => {
    expect(usageConventionFor("brand_new")).toBe("openai_cached_subset");
  });

  it("formats the trace token summary from the normalized buckets", () => {
    const usage = normalizeUsage({
      harness: "claude_code",
      raw: { inputTokens: 10, cachedInputTokens: 90, outputTokens: 5, totalTokens: 105 },
    });
    expect(formatNormalizedUsage(usage)).toBe("in=100 (cached 90) out=5");
  });
});
