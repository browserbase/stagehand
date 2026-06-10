import { describe, expect, it } from "vitest";

import {
  ANTHROPIC_FABLE_5_FALLBACK_MODEL_ID,
  DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT,
  anthropicAdaptiveThinkingOptions,
  anthropicFallbacksOptions,
  isAdaptiveThinkingAnthropicModel,
  rejectsForcedToolUse,
  resolveAdaptiveEffort,
} from "../../lib/v3/llm/anthropicOptions.js";

describe("isAdaptiveThinkingAnthropicModel", () => {
  it("matches adaptive-capable models with or without a provider prefix", () => {
    expect(isAdaptiveThinkingAnthropicModel("claude-fable-5")).toBe(true);
    expect(isAdaptiveThinkingAnthropicModel("anthropic/claude-opus-4-8")).toBe(
      true,
    );
    expect(isAdaptiveThinkingAnthropicModel("claude-sonnet-4-6")).toBe(true);
  });

  it("excludes models without adaptive thinking", () => {
    expect(isAdaptiveThinkingAnthropicModel("claude-opus-4-5-20251101")).toBe(
      false,
    );
    expect(isAdaptiveThinkingAnthropicModel("gpt-5.4")).toBe(false);
  });
});

describe("resolveAdaptiveEffort", () => {
  it("defaults to the shared default when nothing is configured", () => {
    expect(resolveAdaptiveEffort("claude-fable-5")).toBe(
      DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT,
    );
  });

  it("honors the client's explicit effort", () => {
    expect(resolveAdaptiveEffort("claude-opus-4-8", "low")).toBe("low");
    expect(resolveAdaptiveEffort("claude-opus-4-8", "max")).toBe("max");
  });

  it("passes xhigh through on capable models and clamps it elsewhere", () => {
    expect(resolveAdaptiveEffort("claude-opus-4-8", "xhigh")).toBe("xhigh");
    expect(resolveAdaptiveEffort("claude-fable-5", "xhigh")).toBe("xhigh");
    expect(resolveAdaptiveEffort("claude-sonnet-4-6", "xhigh")).toBe("high");
  });

  it("falls back to the default for invalid values", () => {
    expect(resolveAdaptiveEffort("claude-opus-4-8", "bogus")).toBe(
      DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT,
    );
  });
});

describe("anthropicAdaptiveThinkingOptions", () => {
  it("requests adaptive thinking at the default effort", () => {
    expect(
      anthropicAdaptiveThinkingOptions("anthropic/claude-fable-5"),
    ).toEqual({
      thinking: { type: "adaptive" },
      effort: DEFAULT_ANTHROPIC_ADAPTIVE_EFFORT,
    });
  });

  it("honors a client-provided effort", () => {
    expect(
      anthropicAdaptiveThinkingOptions("claude-opus-4-8", "xhigh"),
    ).toEqual({ thinking: { type: "adaptive" }, effort: "xhigh" });
  });

  it('treats "none" as an explicit opt-out of thinking', () => {
    expect(
      anthropicAdaptiveThinkingOptions("claude-fable-5", "none"),
    ).toBeUndefined();
  });

  it("returns undefined for non-adaptive models", () => {
    expect(
      anthropicAdaptiveThinkingOptions("gemini-3.5-flash"),
    ).toBeUndefined();
    expect(
      anthropicAdaptiveThinkingOptions("claude-opus-4-5-20251101"),
    ).toBeUndefined();
  });
});

describe("rejectsForcedToolUse", () => {
  it("is true for Fable 5, where thinking is always on", () => {
    expect(rejectsForcedToolUse("claude-fable-5")).toBe(true);
    expect(rejectsForcedToolUse("anthropic/claude-fable-5")).toBe(true);
  });

  it("is false for models that accept forced tool use", () => {
    expect(rejectsForcedToolUse("claude-opus-4-8")).toBe(false);
    expect(rejectsForcedToolUse("claude-haiku-4-5-20251001")).toBe(false);
    expect(rejectsForcedToolUse("gpt-5.4")).toBe(false);
  });
});

describe("anthropicFallbacksOptions", () => {
  it("enables the server-side fallback chain for Fable 5 only", () => {
    expect(anthropicFallbacksOptions("anthropic/claude-fable-5")).toEqual({
      fallbacks: [{ model: ANTHROPIC_FABLE_5_FALLBACK_MODEL_ID }],
    });
    expect(anthropicFallbacksOptions("claude-opus-4-8")).toBeUndefined();
    expect(anthropicFallbacksOptions("claude-sonnet-4-6")).toBeUndefined();
  });
});
