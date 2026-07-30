import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const LANGSMITH_ENV_KEYS = [
  "LANGSMITH_API_KEY",
  "LANGSMITH_TRACING",
  "EVAL_TRACE_TRANSPORT",
] as const;

const savedEnv = new Map<string, string | undefined>();

beforeEach(() => {
  for (const key of LANGSMITH_ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of LANGSMITH_ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  savedEnv.clear();
  vi.resetModules();
});

async function loadLangSmithHelpers() {
  return import("../../framework/langsmith.js");
}

describe("hasLangSmithApiKey", () => {
  it("returns false without LANGSMITH_API_KEY", async () => {
    const { hasLangSmithApiKey } = await loadLangSmithHelpers();
    expect(hasLangSmithApiKey()).toBe(false);
  });

  it("returns true with LANGSMITH_API_KEY", async () => {
    process.env.LANGSMITH_API_KEY = "ls-test";
    const { hasLangSmithApiKey } = await loadLangSmithHelpers();
    expect(hasLangSmithApiKey()).toBe(true);
  });
});

describe("langSmithTracingEnabled", () => {
  it.each([
    { key: true, flag: true, expected: true },
    { key: true, flag: false, expected: false },
    { key: false, flag: true, expected: false },
    { key: false, flag: false, expected: false },
  ])(
    "returns $expected when key=$key and flag=$flag",
    async ({ key, flag, expected }) => {
      if (key) process.env.LANGSMITH_API_KEY = "ls-test";
      if (flag) process.env.LANGSMITH_TRACING = "true";
      const { langSmithTracingEnabled } = await loadLangSmithHelpers();
      expect(langSmithTracingEnabled()).toBe(expected);
    },
  );

  it("reflects environment changes made after module import", async () => {
    const { langSmithTracingEnabled } = await loadLangSmithHelpers();
    expect(langSmithTracingEnabled()).toBe(false);

    process.env.LANGSMITH_API_KEY = "ls-test";
    process.env.LANGSMITH_TRACING = "true";
    expect(langSmithTracingEnabled()).toBe(true);

    delete process.env.LANGSMITH_TRACING;
    expect(langSmithTracingEnabled()).toBe(false);
  });
});

describe("resolveTraceTransport", () => {
  it("defaults to native", async () => {
    const { resolveTraceTransport } = await loadLangSmithHelpers();
    expect(resolveTraceTransport()).toBe("native");
  });

  it('returns otel for the literal "otel" value', async () => {
    process.env.EVAL_TRACE_TRANSPORT = "otel";
    const { resolveTraceTransport } = await loadLangSmithHelpers();
    expect(resolveTraceTransport()).toBe("otel");
  });
});

describe("assertLangSmithReady", () => {
  it("throws when tracing is enabled without an API key", async () => {
    process.env.LANGSMITH_TRACING = "true";
    const { assertLangSmithReady } = await loadLangSmithHelpers();
    expect(() => assertLangSmithReady()).toThrow(/LANGSMITH_API_KEY/);
  });

  it("throws when the API key is set but tracing is disabled", async () => {
    process.env.LANGSMITH_API_KEY = "ls-test";
    const { assertLangSmithReady } = await loadLangSmithHelpers();
    expect(() => assertLangSmithReady()).toThrow(/LANGSMITH_TRACING/);
  });

  it("does not throw when the API key and tracing flag are set", async () => {
    process.env.LANGSMITH_API_KEY = "ls-test";
    process.env.LANGSMITH_TRACING = "true";
    const { assertLangSmithReady } = await loadLangSmithHelpers();
    expect(() => assertLangSmithReady()).not.toThrow();
  });
});
