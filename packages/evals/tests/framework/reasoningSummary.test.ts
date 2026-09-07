import { describe, expect, it } from "vitest";
import {
  DEFAULT_REASONING_SUMMARY,
  isOpenAiModel,
  openAiReasoningProviderOptions,
  readReasoningSummary,
} from "../../framework/reasoningSummary.js";

describe("reasoning summary switch", () => {
  it("is on by default and honours every documented spelling of off", () => {
    expect(readReasoningSummary({})).toBe(DEFAULT_REASONING_SUMMARY);
    expect(readReasoningSummary({ EVAL_REASONING_SUMMARY: "auto" })).toBe("auto");
    expect(readReasoningSummary({ EVAL_REASONING_SUMMARY: "Concise" })).toBe("concise");
    for (const off of ["off", "none", "false", "0"]) {
      expect(readReasoningSummary({ EVAL_REASONING_SUMMARY: off })).toBeUndefined();
    }
    expect(readReasoningSummary({ EVAL_REASONING_SUMMARY: "verbose" })).toBe(
      DEFAULT_REASONING_SUMMARY,
    );
  });

  it("only asks OpenAI models for summaries", () => {
    expect(isOpenAiModel("openai/gpt-5.6-luna")).toBe(true);
    expect(isOpenAiModel("gpt-5.4-mini")).toBe(true);
    expect(isOpenAiModel("anthropic/claude-sonnet-4-6")).toBe(false);
    expect(openAiReasoningProviderOptions("openai/gpt-5.6-luna", {})).toEqual({
      openai: { reasoningSummary: "detailed" },
    });
    expect(openAiReasoningProviderOptions("anthropic/claude-sonnet-4-6", {})).toBeUndefined();
    expect(
      openAiReasoningProviderOptions("openai/gpt-5.6-luna", { EVAL_REASONING_SUMMARY: "off" }),
    ).toBeUndefined();
  });
});
