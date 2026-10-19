import { describe, expect, it, vi } from "vitest";

import { createStringMatcher, pollWatch } from "../src/lib/driver/watch.js";

describe("watch helpers", () => {
  it("matches substring by default", () => {
    const matcher = createStringMatcher("confirmed", false);
    expect(matcher("Order confirmed")).toBe(true);
    expect(matcher("Pending")).toBe(false);
  });

  it("matches regex when enabled", () => {
    const matcher = createStringMatcher("Order #\\d+", true);
    expect(matcher("Order #123")).toBe(true);
    expect(matcher("Order pending")).toBe(false);
  });

  it("polls until a condition is met", async () => {
    const check = vi
      .fn<() => Promise<{ matched: boolean; value?: string }>>()
      .mockResolvedValueOnce({ matched: false, value: "Pending" })
      .mockResolvedValueOnce({ matched: false, value: "Pending" })
      .mockResolvedValueOnce({ matched: true, value: "Confirmed" });

    const result = await pollWatch({
      check,
      intervalMs: 1,
      timeoutMs: 1_000,
    });

    expect(result.attempts).toBe(3);
    expect(result.value).toBe("Confirmed");
  });

  it("times out when condition is never met", async () => {
    const check = vi
      .fn<() => Promise<{ matched: boolean; value?: string }>>()
      .mockResolvedValue({ matched: false, value: "Pending" });

    await expect(
      pollWatch({
        check,
        intervalMs: 1,
        timeoutMs: 5,
      }),
    ).rejects.toThrow("Watch condition not met within");
  });
});
