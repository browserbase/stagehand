import { describe, expect, it } from "vitest";
import { capForSpan } from "../../framework/runner.js";

const MAX = 2_000_000;
const bytes = (v: unknown): number => Buffer.byteLength(JSON.stringify(v), "utf8");

describe("capForSpan", () => {
  it("returns small payloads unchanged", () => {
    const value = { _success: true, metrics: { steps: 3 }, logs: ["a", "b"] };
    expect(capForSpan(value)).toBe(value);
  });

  it("keeps a trailing slice of logs when the payload exceeds the cap", () => {
    // ~4MB: 400 entries x ~10KB. Distinguishable so we can assert the tail survives.
    const logs = Array.from({ length: 400 }, (_, i) => `entry-${i}-${"x".repeat(10_000)}`);
    const capped = capForSpan({ _success: false, logs });

    expect(bytes(capped)).toBeLessThanOrEqual(MAX);
    const kept = capped.logs as string[];
    expect(kept.length).toBeGreaterThan(0);
    expect(kept.length).toBeLessThan(logs.length);
    // Tail-preserving: kept entries are a contiguous suffix of the input.
    expect(kept).toEqual(logs.slice(logs.length - kept.length));
    expect(capped._truncated).toMatch(/exceeded/);
  });

  it("drops oversized non-log payloads so the result is always within the cap", () => {
    const capped = capForSpan({
      _success: false,
      error: "e".repeat(2_500_000),
      logs: ["a"],
    });
    expect(bytes(capped)).toBeLessThanOrEqual(MAX);
    expect(capped.error).toBeUndefined();
    expect(capped._truncated).toMatch(/non-log fields were dropped/);
  });

  it("measures UTF-8 bytes, not UTF-16 code units", () => {
    // "€" = 1 UTF-16 unit but 3 UTF-8 bytes: JSON char length is under the cap
    // while the byte length is over — a char-counting cap would wrongly pass it.
    const value = { note: "€".repeat(700_000) };
    expect(JSON.stringify(value).length).toBeLessThan(MAX);
    expect(bytes(value)).toBeGreaterThan(MAX);

    const capped = capForSpan(value);
    expect(bytes(capped)).toBeLessThanOrEqual(MAX);
    expect(capped.note).toBeUndefined();
    expect(capped._truncated).toBeDefined();
  });

  it("falls back to a serializable marker when the payload can't be stringified", () => {
    const circular: Record<string, unknown> = { _success: true };
    circular.self = circular;
    const capped = capForSpan(circular);
    expect(capped._truncated).toBeDefined();
    expect(() => JSON.stringify(capped)).not.toThrow();
  });
});
