import { describe, it, expect } from "vitest";
import { createMetricsCollector } from "../../framework/metrics.js";

describe("createMetricsCollector", () => {
  it("records and retrieves values", () => {
    const m = createMetricsCollector();
    m.record("latency", 10);
    m.record("latency", 20);
    m.record("other", 5);

    const all = m.getAll();
    expect(all.latency).toEqual([10, 20]);
    expect(all.other).toEqual([5]);
  });

  it("startTimer records positive duration", async () => {
    const m = createMetricsCollector();
    const stop = m.startTimer("op");

    // Burn a tiny amount of time
    await new Promise((r) => setTimeout(r, 5));
    const duration = stop();

    expect(duration).toBeGreaterThan(0);
    const all = m.getAll();
    expect(all.op).toHaveLength(1);
    expect(all.op[0]).toBe(duration);
  });

  it("tracks multiple metrics independently", () => {
    const m = createMetricsCollector();
    m.record("a", 1);
    m.record("b", 2);
    m.record("a", 3);

    const all = m.getAll();
    expect(all.a).toEqual([1, 3]);
    expect(all.b).toEqual([2]);
  });

  describe("getSummary", () => {
    it("returns empty object when nothing recorded", () => {
      const m = createMetricsCollector();
      expect(m.getSummary()).toEqual({});
    });

    it("computes correct stats for known values", () => {
      const m = createMetricsCollector();
      m.record("x", 10);
      m.record("x", 20);
      m.record("x", 30);

      const summary = m.getSummary();
      expect(summary.x.min).toBe(10);
      expect(summary.x.max).toBe(30);
      expect(summary.x.avg).toBe(20);
      expect(summary.x.count).toBe(3);
    });

    it("computes percentiles", () => {
      const m = createMetricsCollector();
      // Record 1..100
      for (let i = 1; i <= 100; i++) {
        m.record("p", i);
      }

      const summary = m.getSummary();
      expect(summary.p.p50).toBe(50);
      expect(summary.p.p99).toBe(99);
      expect(summary.p.min).toBe(1);
      expect(summary.p.max).toBe(100);
      expect(summary.p.count).toBe(100);
    });

    it("handles single value", () => {
      const m = createMetricsCollector();
      m.record("solo", 42);

      const summary = m.getSummary();
      expect(summary.solo).toEqual({
        count: 1,
        value: 42,
      });
    });
  });
});
