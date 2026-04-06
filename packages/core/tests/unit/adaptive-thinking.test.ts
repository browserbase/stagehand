import { describe, expect, it } from "vitest";
import { supportsAdaptiveThinking } from "../../lib/v3/agent/utils/adaptiveThinking.js";

describe("supportsAdaptiveThinking", () => {
  it("returns true for claude-opus-4-6 models", () => {
    expect(supportsAdaptiveThinking("anthropic/claude-opus-4-6")).toBe(true);
  });

  it("returns true for claude-sonnet-4-6 models", () => {
    expect(supportsAdaptiveThinking("anthropic/claude-sonnet-4-6")).toBe(true);
  });

  it("returns true for dated variants of 4-6 models", () => {
    expect(
      supportsAdaptiveThinking("anthropic/claude-sonnet-4-6-20260301"),
    ).toBe(true);
    expect(
      supportsAdaptiveThinking("anthropic/claude-opus-4-6-20260301"),
    ).toBe(true);
  });

  it("returns false for older Anthropic models", () => {
    expect(
      supportsAdaptiveThinking("anthropic/claude-sonnet-4-20250514"),
    ).toBe(false);
    expect(
      supportsAdaptiveThinking("anthropic/claude-sonnet-4-5-20250929"),
    ).toBe(false);
    expect(
      supportsAdaptiveThinking("anthropic/claude-haiku-4-5-20251001"),
    ).toBe(false);
    expect(
      supportsAdaptiveThinking("anthropic/claude-opus-4-5-20251101"),
    ).toBe(false);
  });

  it("returns false for non-Anthropic models", () => {
    expect(supportsAdaptiveThinking("openai/gpt-4o")).toBe(false);
    expect(supportsAdaptiveThinking("google/gemini-2.0-flash")).toBe(false);
  });

  it("returns false for undefined or empty model names", () => {
    expect(supportsAdaptiveThinking(undefined)).toBe(false);
    expect(supportsAdaptiveThinking("")).toBe(false);
  });
});
