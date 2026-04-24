import { describe, expect, it } from "vitest";
import {
  isReasoningModelWithoutTemperatureSupport,
  resolveTemperatureForModel,
} from "../../lib/v3/llm/modelCapabilities.js";

describe("model temperature compatibility", () => {
  it("identifies GPT-5 family models as not supporting temperature", () => {
    expect(
      isReasoningModelWithoutTemperatureSupport("openai/gpt-5.4-mini"),
    ).toBe(true);
    expect(isReasoningModelWithoutTemperatureSupport("gpt-5-mini")).toBe(true);
  });

  it("identifies o-series reasoning models as not supporting temperature", () => {
    expect(isReasoningModelWithoutTemperatureSupport("openai/o3")).toBe(true);
    expect(isReasoningModelWithoutTemperatureSupport("azure/o4-mini")).toBe(
      true,
    );
  });

  it("preserves temperature for models that still support it", () => {
    expect(
      resolveTemperatureForModel("anthropic/claude-haiku-4-5-20251001", 1),
    ).toBe(1);
  });

  it("forces temperature=1 for kimi and omits it for claude-opus-4-7", () => {
    expect(resolveTemperatureForModel("moonshotai/kimi-k2-instruct", 0.1)).toBe(
      1,
    );
    expect(resolveTemperatureForModel("anthropic/claude-opus-4-7", 0.1)).toBe(
      undefined,
    );
  });
});
