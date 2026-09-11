import { describe, expect, it } from "vitest";
import { buildAllowlistedEnv, sanitizeErrorMessage } from "../src/harness/index.js";

describe("harness contract", () => {
  it("redacts credential-bearing URL query parameters", () => {
    expect(sanitizeErrorMessage("wss://example.test?signingKey=top-secret&foo=bar")).toBe(
      "wss://example.test?signingKey=[redacted]&foo=bar",
    );
  });

  it("redacts OpenAI-style secret keys", () => {
    expect(sanitizeErrorMessage("key sk-abcdef1234567890")).toBe("key sk-abcdef[redacted]");
  });

  it("redacts Browserbase keys", () => {
    expect(sanitizeErrorMessage("key bb_live_abcd1234567890")).toBe("key bb_live_abcd[redacted]");
  });

  it("redacts Google API keys", () => {
    expect(sanitizeErrorMessage(`key AIza${"a".repeat(32)}`)).toBe("key AIza[redacted]");
  });

  it("redacts bearer authorization values", () => {
    expect(sanitizeErrorMessage("Authorization: Bearer abcdefgh123456")).toBe(
      "Authorization: Bearer [redacted]",
    );
  });

  it("allows Stagehand and Browserbase env vars while excluding other and empty values", () => {
    const env = buildAllowlistedEnv({
      STAGEHAND_MODEL: "model",
      BROWSERBASE_API_KEY: "browserbase-key",
      STAGEHAND_EMPTY: "",
      NOT_ALLOWLISTED_SECRET: "secret",
    });

    expect(env.STAGEHAND_MODEL).toBe("model");
    expect(env.BROWSERBASE_API_KEY).toBe("browserbase-key");
    expect(env).not.toHaveProperty("STAGEHAND_EMPTY");
    expect(env).not.toHaveProperty("NOT_ALLOWLISTED_SECRET");
  });
});
