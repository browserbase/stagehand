import { describe, expect, it } from "vitest";
import { capForSpan } from "../../framework/runner.js";

const MAX_SPAN_PAYLOAD_BYTES = 2_000_000;

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

describe("capForSpan", () => {
  it("returns small payloads unchanged", () => {
    const value = { _success: true, metrics: { steps: 3 }, logs: ["a", "b"] };
    expect(capForSpan(value)).toBe(value);
  });

  it("flags payloads that cannot be serialized", () => {
    const circular: Record<string, unknown> = { _success: true };
    circular.self = circular;
    expect(capForSpan(circular)).toEqual({
      _truncated: "payload not serializable",
    });
  });

  it("keeps a tail of logs when the payload exceeds the cap", () => {
    // ~4MB of logs: 400 entries × ~10KB each. Entries are distinguishable so
    // we can assert the *tail* (newest) is what survives.
    const logs = Array.from(
      { length: 400 },
      (_, i) => `entry-${i}-${"x".repeat(10_000)}`,
    );
    const value = { _success: false, logs };

    const capped = capForSpan(value);

    expect(jsonBytes(capped)).toBeLessThanOrEqual(MAX_SPAN_PAYLOAD_BYTES);
    const keptLogs = capped.logs as string[];
    expect(keptLogs.length).toBeGreaterThan(0);
    expect(keptLogs.length).toBeLessThan(logs.length);
    // Tail-preserving: the kept entries are a contiguous suffix of the input.
    expect(keptLogs).toEqual(logs.slice(logs.length - keptLogs.length));
    expect(keptLogs[keptLogs.length - 1]).toBe(logs[logs.length - 1]);
    expect(capped._truncated).toMatch(/kept the last \d+ of 400 log entries/);
  });

  it("drops oversized non-log fields so the result is always within the cap (P1)", () => {
    // A single non-`logs` field alone blows the cap; trimming logs can't help.
    const value = {
      _success: false,
      error: "e".repeat(2_500_000),
      metrics: { steps: 2 },
      logs: ["a", "b"],
    };

    const capped = capForSpan(value);

    expect(jsonBytes(capped)).toBeLessThanOrEqual(MAX_SPAN_PAYLOAD_BYTES);
    expect(capped.error).toBeUndefined();
    expect(capped._success).toBe(false); // small scalar survives
    expect(capped.metrics).toEqual({ steps: 2 }); // small object survives
    expect(capped._truncated).toMatch(/oversized fields omitted/);
  });

  it("measures bytes, not UTF-16 code units (P2)", () => {
    // "€" is 1 UTF-16 unit but 3 UTF-8 bytes. This string's JSON char length
    // is under the cap, but its byte length is over — a char-counting cap
    // would wrongly pass it through whole.
    const value = { note: "€".repeat(700_000) };
    expect(JSON.stringify(value).length).toBeLessThan(MAX_SPAN_PAYLOAD_BYTES);
    expect(jsonBytes(value)).toBeGreaterThan(MAX_SPAN_PAYLOAD_BYTES);

    const capped = capForSpan(value);

    expect(jsonBytes(capped)).toBeLessThanOrEqual(MAX_SPAN_PAYLOAD_BYTES);
    expect(capped.note).toBeUndefined();
    expect(capped._truncated).toBeDefined();
  });
});
