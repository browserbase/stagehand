import { afterEach, describe, expect, it } from "vitest";

import {
  ANTHROPIC_FABLE_5_FALLBACK_MODEL_ID,
  anthropicAdaptiveThinkingOptions,
  anthropicFallbacksOptions,
  isAdaptiveThinkingAnthropicModel,
  rejectsForcedToolUse,
  resolveAdaptiveEffort,
} from "../../lib/v3/llm/anthropicOptions.js";

const ENV_KEY = "STAGEHAND_THINKING_EFFORT";
const envBefore = process.env[ENV_KEY];

afterEach(() => {
  if (envBefore === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = envBefore;
});

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
  it("returns undefined when nothing is configured (API default)", () => {
    delete process.env[ENV_KEY];
    expect(resolveAdaptiveEffort("claude-fable-5")).toBeUndefined();
  });

  it("passes xhigh through on capable models", () => {
    expect(resolveAdaptiveEffort("claude-opus-4-8", "xhigh")).toBe("xhigh");
    expect(resolveAdaptiveEffort("claude-fable-5", "xhigh")).toBe("xhigh");
  });

  it("clamps xhigh to high on models that reject it", () => {
    expect(resolveAdaptiveEffort("claude-sonnet-4-6", "xhigh")).toBe("high");
  });

  it("prefers the explicit value over the env knob", () => {
    process.env[ENV_KEY] = "low";
    expect(resolveAdaptiveEffort("claude-opus-4-8", "medium")).toBe("medium");
    expect(resolveAdaptiveEffort("claude-opus-4-8")).toBe("low");
  });

  it("ignores invalid values and none", () => {
    expect(resolveAdaptiveEffort("claude-opus-4-8", "none")).toBeUndefined();
    expect(resolveAdaptiveEffort("claude-opus-4-8", "bogus")).toBeUndefined();
  });
});

describe("anthropicAdaptiveThinkingOptions", () => {
  it("requests adaptive thinking for capable models", () => {
    expect(
      anthropicAdaptiveThinkingOptions("anthropic/claude-fable-5"),
    ).toEqual({ thinking: { type: "adaptive" } });
    expect(
      anthropicAdaptiveThinkingOptions("claude-opus-4-8", "xhigh"),
    ).toEqual({ thinking: { type: "adaptive" }, effort: "xhigh" });
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
