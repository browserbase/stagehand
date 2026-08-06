import { describe, expect, it } from "vitest";
import { stagehandCodeConfigFromEnv } from "../src/codemode/config.js";

describe("stagehandCodeConfigFromEnv", () => {
  it("defaults to a headless local browser without Browserbase credentials", () => {
    expect(stagehandCodeConfigFromEnv({})).toMatchObject({
      browser: { type: "local", launchOptions: { headless: true } },
      stagehand: { logging: { level: "off" } },
    });
  });

  it("lets an explicit local selection win when Browserbase credentials are present", () => {
    expect(
      stagehandCodeConfigFromEnv({
        STAGEHAND_BROWSER: " local ",
        BROWSERBASE_API_KEY: "bb_secret",
        BROWSERBASE_PROJECT_ID: "project-id",
      }).browser,
    ).toStrictEqual({ type: "local", launchOptions: { headless: true } });
  });

  it("forwards Browserbase API key and project ID", () => {
    expect(
      stagehandCodeConfigFromEnv({
        STAGEHAND_BROWSER: "browserbase",
        BROWSERBASE_API_KEY: " bb_secret ",
        BROWSERBASE_PROJECT_ID: " project-id ",
      }).browser,
    ).toStrictEqual({
      type: "browserbase",
      launchOptions: { apiKey: "bb_secret", projectId: "project-id" },
    });
  });

  it("omits a blank Browserbase project ID", () => {
    expect(
      stagehandCodeConfigFromEnv({
        BROWSERBASE_API_KEY: "bb_secret",
        BROWSERBASE_PROJECT_ID: "   ",
      }).browser,
    ).toStrictEqual({
      type: "browserbase",
      launchOptions: { apiKey: "bb_secret" },
    });
  });

  it("rejects invalid or unauthenticated Browserbase selections", () => {
    expect(() => stagehandCodeConfigFromEnv({ STAGEHAND_BROWSER: "remote" })).toThrow(
      'STAGEHAND_BROWSER must be either "local" or "browserbase".',
    );
    expect(() => stagehandCodeConfigFromEnv({ STAGEHAND_BROWSER: "browserbase" })).toThrow(
      'BROWSERBASE_API_KEY is required when STAGEHAND_BROWSER="browserbase".',
    );
  });

  it.each([
    ["openai/gpt-5.4-mini", "OPENAI_API_KEY", "openai-key"],
    ["anthropic/claude-sonnet-4-6", "ANTHROPIC_API_KEY", "anthropic-key"],
    ["google/gemini-3-flash-preview", "GEMINI_API_KEY", "google-key"],
    ["groq/llama-3.3-70b-versatile", "GROQ_API_KEY", "groq-key"],
    ["cerebras/llama3.1-8b", "CEREBRAS_API_KEY", "cerebras-key"],
  ])("pairs an explicit %s model with its provider key", (modelName, envName, apiKey) => {
    const config = stagehandCodeConfigFromEnv({
      STAGEHAND_MODEL_NAME: modelName,
      [envName]: apiKey,
    });

    expect(config.stagehand?.model).toStrictEqual({
      modelName,
      apiKey,
      ...(modelName.startsWith("anthropic/")
        ? {
            headers: {
              "anthropic-dangerous-direct-browser-access": "true",
            },
          }
        : {}),
    });
  });

  it("prefers the explicit model key over provider environment keys", () => {
    const config = stagehandCodeConfigFromEnv({
      STAGEHAND_MODEL_NAME: "openai/gpt-5.4-mini",
      STAGEHAND_MODEL_API_KEY: "explicit-key",
      OPENAI_API_KEY: "provider-key",
    });

    expect(config.stagehand?.model).toStrictEqual({
      modelName: "openai/gpt-5.4-mini",
      apiKey: "explicit-key",
    });
  });

  it("uses the eval-native Google key precedence", () => {
    const config = stagehandCodeConfigFromEnv({
      STAGEHAND_MODEL_NAME: "google/gemini-3-flash-preview",
      GEMINI_API_KEY: "gemini-key",
      GOOGLE_GENERATIVE_AI_API_KEY: "generative-key",
      GOOGLE_API_KEY: "google-key",
    });

    expect(config.stagehand?.model).toStrictEqual({
      modelName: "google/gemini-3-flash-preview",
      apiKey: "gemini-key",
    });
  });

  it("infers the default Google model only when no model is explicit", () => {
    const config = stagehandCodeConfigFromEnv({
      GOOGLE_GENERATIVE_AI_API_KEY: "generative-key",
    });

    expect(config.stagehand?.model).toStrictEqual({
      modelName: "google/gemini-2.5-flash-lite",
      apiKey: "generative-key",
    });
  });

  it("does not apply Google credentials to an explicit non-Google model", () => {
    const config = stagehandCodeConfigFromEnv({
      STAGEHAND_MODEL_NAME: "anthropic/claude-sonnet-4-6",
      GEMINI_API_KEY: "google-key",
    });

    expect(config.stagehand?.model).toStrictEqual({
      modelName: "anthropic/claude-sonnet-4-6",
      headers: {
        "anthropic-dangerous-direct-browser-access": "true",
      },
    });
  });

  it("rejects an explicit model key without a model name", () => {
    expect(() => stagehandCodeConfigFromEnv({ STAGEHAND_MODEL_API_KEY: "orphan-key" })).toThrow(
      "STAGEHAND_MODEL_NAME is required when STAGEHAND_MODEL_API_KEY is set.",
    );
  });
});
