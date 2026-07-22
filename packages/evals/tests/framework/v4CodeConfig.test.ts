import { describe, expect, it } from "vitest";
import {
  ANTHROPIC_DIRECT_BROWSER_ACCESS_HEADER,
  normalizeV4ModelName,
  resolveV4CodeModelConfig,
} from "../../framework/v4CodeConfig.js";

describe("V4 code model configuration", () => {
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
});
