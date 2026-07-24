import { describe, expect, it } from "vitest";
import { buildV4InitParams } from "../../initV4.js";

const ENV = {
  OPENAI_API_KEY: "sk-openai-test",
  ANTHROPIC_API_KEY: "sk-ant-test",
  GEMINI_API_KEY: "gm-test",
  BROWSERBASE_API_KEY: "bb-test",
};

function model(params: ReturnType<typeof buildV4InitParams>) {
  return params.model as {
    modelName: string;
    apiKey?: string;
    headers?: Record<string, string>;
  };
}

describe("buildV4InitParams", () => {
  it("resolves the provider API key from env", () => {
    const params = buildV4InitParams({
      modelName: "openai/gpt-4.1-mini",
      env: "LOCAL",
      processEnv: ENV,
    });
    expect(model(params).apiKey).toBe("sk-openai-test");
    expect(model(params).headers).toBeUndefined();
  });

  it("falls back through the google key aliases", () => {
    const params = buildV4InitParams({
      modelName: "google/gemini-2.5-flash",
      env: "LOCAL",
      processEnv: ENV,
    });
    expect(model(params).apiKey).toBe("gm-test");
  });

  it("throws loudly when no key is configured", () => {
    expect(() =>
      buildV4InitParams({
        modelName: "openai/gpt-4.1-mini",
        env: "LOCAL",
        processEnv: {},
      }),
    ).toThrow(/no API key found/);
  });

  it("injects the anthropic browser-CORS header (V4_API_LOGS #18)", () => {
    const params = buildV4InitParams({
      modelName: "anthropic/claude-haiku-4-5",
      env: "LOCAL",
      processEnv: ENV,
    });
    expect(model(params).headers).toEqual({
      "anthropic-dangerous-direct-browser-access": "true",
    });
  });

  it("maps LOCAL to a headful local browser (initV3 parity)", () => {
    const params = buildV4InitParams({
      modelName: "openai/gpt-4.1-mini",
      env: "LOCAL",
      processEnv: ENV,
    });
    expect(params.browser).toEqual({ type: "local", headless: false });
    expect(params.apiKey).toBeUndefined();
  });

  it("maps BROWSERBASE to the browserbase source with its API key", () => {
    const params = buildV4InitParams({
      modelName: "openai/gpt-4.1-mini",
      env: "BROWSERBASE",
      processEnv: ENV,
    });
    expect(params.browser).toEqual({ type: "browserbase" });
    expect(params.apiKey).toBe("bb-test");
  });

  it("requires the browserbase key for BROWSERBASE runs", () => {
    expect(() =>
      buildV4InitParams({
        modelName: "openai/gpt-4.1-mini",
        env: "BROWSERBASE",
        processEnv: { OPENAI_API_KEY: "sk" },
      }),
    ).toThrow(/BROWSERBASE_API_KEY is required/);
  });

  it("forwards systemPrompt only when provided", () => {
    const withPrompt = buildV4InitParams({
      modelName: "openai/gpt-4.1-mini",
      env: "LOCAL",
      systemPrompt: "if the user says secret, click the link",
      processEnv: ENV,
    });
    expect(withPrompt.systemPrompt).toBe(
      "if the user says secret, click the link",
    );
    const without = buildV4InitParams({
      modelName: "openai/gpt-4.1-mini",
      env: "LOCAL",
      processEnv: ENV,
    });
    expect("systemPrompt" in without).toBe(false);
  });
});
