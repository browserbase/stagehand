import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { hasBraintrustApiKey, tracedSpan } from "../../framework/braintrust.js";

/**
 * Verify that braintrust.ts helpers and AISdkClientWrapped work without
 * BRAINTRUST_API_KEY. The runner-level tests live in a separate file
 * (braintrust-runner-nolog.test.ts) because they need to vi.mock the
 * braintrust module entirely.
 */

describe("braintrust.ts helpers without BRAINTRUST_API_KEY", () => {
  const originalKey = process.env.BRAINTRUST_API_KEY;

  beforeEach(() => {
    delete process.env.BRAINTRUST_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.BRAINTRUST_API_KEY = originalKey;
    } else {
      delete process.env.BRAINTRUST_API_KEY;
    }
  });

  it("hasBraintrustApiKey returns false when BRAINTRUST_API_KEY is unset", () => {
    expect(hasBraintrustApiKey()).toBe(false);
  });

  it("hasBraintrustApiKey returns true when BRAINTRUST_API_KEY is set", () => {
    process.env.BRAINTRUST_API_KEY = "test-key-123";
    expect(hasBraintrustApiKey()).toBe(true);
  });

  it("tracedSpan calls fn directly without Braintrust when key is absent", async () => {
    const fn = vi.fn(async () => 42);
    const result = await tracedSpan(fn, { name: "test-span" });
    expect(fn).toHaveBeenCalledOnce();
    expect(result).toBe(42);
  });
});

describe("AISdkClientWrapped without BRAINTRUST_API_KEY", () => {
  const originalKey = process.env.BRAINTRUST_API_KEY;

  beforeEach(() => {
    delete process.env.BRAINTRUST_API_KEY;
  });

  afterEach(() => {
    if (originalKey !== undefined) {
      process.env.BRAINTRUST_API_KEY = originalKey;
    } else {
      delete process.env.BRAINTRUST_API_KEY;
    }
  });

  it("AISdkClientWrapped class is importable without BRAINTRUST_API_KEY", async () => {
    const mod = await import("../../lib/AISdkClientWrapped.js");
    expect(mod.AISdkClientWrapped).toBeDefined();
  });
});
