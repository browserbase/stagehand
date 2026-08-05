import { describe, expect, it } from "vitest";
import { resolveStagehandModel } from "../initStagehand.js";

describe("Stagehand eval model configuration", () => {
  const lookup =
    (values: Record<string, string>) =>
    (name: string): string =>
      values[name] ?? "";

  it("keeps deterministic code tools model-free", () => {
    expect(resolveStagehandModel(undefined, lookup({}))).toBeUndefined();
  });

  it("resolves provider keys for AI-enabled code tools", () => {
    const keys = lookup({ OPENAI_API_KEY: "openai-key" });

    expect(resolveStagehandModel("openai/gpt-4.1-mini", keys)).toEqual({
      modelName: "openai/gpt-4.1-mini",
      apiKey: "openai-key",
    });
  });

  it("rejects an AI-enabled model without a provider key", () => {
    expect(() => resolveStagehandModel("openai/gpt-4.1-mini", lookup({}))).toThrow(
      /no API key found/,
    );
  });
});
