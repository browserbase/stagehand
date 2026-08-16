import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_RUN_TOOL_NAME,
  AGENT_RUN_TOOL_SERVER,
  buildAllowlistedEnv,
  sanitizeErrorMessage,
} from "../src/harness/index.js";

describe("harness contract", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("derives the run tool name from the server name", () => {
    expect(AGENT_RUN_TOOL_NAME).toBe(`mcp__${AGENT_RUN_TOOL_SERVER}__run`);
  });

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
    vi.stubEnv("STAGEHAND_MODEL", "model");
    vi.stubEnv("BROWSERBASE_API_KEY", "browserbase-key");
    vi.stubEnv("STAGEHAND_EMPTY", "");
    vi.stubEnv("NOT_ALLOWLISTED_SECRET", "secret");

    const env = buildAllowlistedEnv();

    expect(env.STAGEHAND_MODEL).toBe("model");
    expect(env.BROWSERBASE_API_KEY).toBe("browserbase-key");
    expect(env).not.toHaveProperty("STAGEHAND_EMPTY");
    expect(env).not.toHaveProperty("NOT_ALLOWLISTED_SECRET");
  });
});
