import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER,
  normalizeV4ModelName,
  resolveV4BrowserbaseConfig,
  resolveV4CodeModelConfig,
} from "../../framework/v4CodeConfig.js";

describe("V4 code model configuration", () => {
  it("resolves canonical and fallback Browserbase credentials without logging values", () => {
    expect(
      resolveV4BrowserbaseConfig({
        BROWSERBASE_API_KEY: " canonical-key ",
        BROWSERBASE_PROJECT_ID: " canonical-project ",
        BROWSERBASE_REGION: "us-west-2",
      }),
    ).toEqual({
      type: "browserbase",
      apiKey: "canonical-key",
      projectId: "canonical-project",
      region: "us-west-2",
    });
    expect(
      resolveV4BrowserbaseConfig({
        BB_API_KEY: "fallback-key",
        BB_PROJECT_ID: "fallback-project",
      }),
    ).toEqual({
      type: "browserbase",
      apiKey: "fallback-key",
      projectId: "fallback-project",
    });
    expect(() => resolveV4BrowserbaseConfig({})).toThrow(
      /BROWSERBASE_API_KEY or BB_API_KEY/,
    );
    expect(() =>
      resolveV4BrowserbaseConfig({
        BROWSERBASE_API_KEY: "secret-value",
        BROWSERBASE_REGION: "invalid-region",
      }),
    ).toThrow(/BROWSERBASE_REGION must be one of/);
  });

  it("normalizes bare harness model identifiers for V4", () => {
    expect(normalizeV4ModelName("claude-sonnet-5")).toBe(
      "anthropic/claude-sonnet-5",
    );
    expect(normalizeV4ModelName("gpt-5.4-mini")).toBe("openai/gpt-5.4-mini");
    expect(normalizeV4ModelName("anthropic/claude-sonnet-5")).toBe(
      "anthropic/claude-sonnet-5",
    );
  });

  it("adds the required direct-browser header for Anthropic", () => {
    expect(
      resolveV4CodeModelConfig("claude-sonnet-5", {
        ANTHROPIC_API_KEY: "test-anthropic-key",
      }),
    ).toEqual({
      modelName: "anthropic/claude-sonnet-5",
      apiKey: "test-anthropic-key",
      headers: {
        [ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER]: "true",
      },
    });
  });

  it("does not add Anthropic headers to another direct provider", () => {
    expect(
      resolveV4CodeModelConfig("openai/gpt-5.4-mini", {
        OPENAI_API_KEY: "test-openai-key",
      }),
    ).toEqual({
      modelName: "openai/gpt-5.4-mini",
      apiKey: "test-openai-key",
    });
  });

  it("fails clearly when the selected model credential is missing", () => {
    expect(() =>
      resolveV4CodeModelConfig("anthropic/claude-sonnet-5", {}),
    ).toThrow(/requires ANTHROPIC_API_KEY/);
    expect(() => normalizeV4ModelName("unknown-model")).toThrow(
      /cannot infer a V4 model provider/,
    );
  });

  it("rejects malformed provider-prefixed model identifiers", () => {
    expect(() => normalizeV4ModelName("anthropic/")).toThrow(
      /requires a model after provider "anthropic"/,
    );
    expect(() => normalizeV4ModelName("toString/foo")).toThrow(
      /does not support provider "toString"/,
    );
  });
});
