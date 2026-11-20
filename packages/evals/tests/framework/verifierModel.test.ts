import { describe, expect, it } from "vitest";

import {
  DEFAULT_VERIFIER_MODEL,
  resolveOpenRouterVerifier,
  resolveVerifierModel,
} from "../../framework/verifierModel.js";

describe("resolveVerifierModel", () => {
  it("prefers EVAL_VERIFIER_MODEL over the default", () => {
    expect(resolveVerifierModel({})).toEqual({
      modelName: DEFAULT_VERIFIER_MODEL,
      source: "default",
    });
    expect(resolveVerifierModel({ EVAL_VERIFIER_MODEL: " openai/gpt-5.4-mini " })).toEqual({
      modelName: "openai/gpt-5.4-mini",
      source: "env",
    });
  });
});

describe("resolveOpenRouterVerifier", () => {
  it("maps an openrouter/ judge onto the OpenAI client at OpenRouter's endpoint", () => {
    expect(
      resolveOpenRouterVerifier("openrouter/google/gemini-3.5-flash", {
        OPENROUTER_API_KEY: " or-key ",
      }),
    ).toEqual({
      modelName: "openai/google/gemini-3.5-flash",
      modelClientOptions: { apiKey: "or-key", baseURL: "https://openrouter.ai/api/v1" },
    });
  });

  it("leaves every other judge to the evaluator's own provider routing", () => {
    expect(resolveOpenRouterVerifier("google/gemini-3.5-flash", {})).toBeUndefined();
    expect(resolveOpenRouterVerifier("openai/gpt-5.4-mini", { OPENROUTER_API_KEY: "or" })).toBe(
      undefined,
    );
  });

  it("fails loudly when the key is missing", () => {
    expect(() => resolveOpenRouterVerifier("openrouter/google/gemini-3.5-flash", {})).toThrow(
      "OPENROUTER_API_KEY is not set",
    );
  });
});
