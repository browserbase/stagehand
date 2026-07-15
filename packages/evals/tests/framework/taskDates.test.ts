import { describe, expect, it } from "vitest";

import { previousMonthFirstDayLabel } from "../../framework/taskDates.js";

describe("previousMonthFirstDayLabel", () => {
  it("returns the first of the previous month", () => {
    expect(previousMonthFirstDayLabel(new Date(2026, 6, 15))).toBe(
      "Jun 1, 2026",
    );
  });

  it("rolls back to December of the PRIOR year in January", () => {
    // The bug this guards: a year-less "Dec 1" would read as ~11 months in the
    // future. The year must roll back with the month.
    expect(previousMonthFirstDayLabel(new Date(2026, 0, 10))).toBe(
      "Dec 1, 2025",
    );
  });

  it("does not overflow when the current day exceeds the previous month's length", () => {
    // The classic setMonth() trap: shifting the month on Mar 31 asks for
    // "Feb 31" and overflows forward into March. Pinning the day to 1 first
    // (or building from parts) must yield Feb, not Mar.
    expect(previousMonthFirstDayLabel(new Date(2026, 2, 31))).toBe(
      "Feb 1, 2026",
    );
    // Same trap on a 31-day month preceded by a 30-day one.
    expect(previousMonthFirstDayLabel(new Date(2026, 4, 31))).toBe(
      "Apr 1, 2026",
    );
  });

  it("handles the leap-year February boundary", () => {
    expect(previousMonthFirstDayLabel(new Date(2024, 2, 30))).toBe(
      "Feb 1, 2024",
    );
  });

  it("is always in the past and within WebMD's ~90-day accepted window", () => {
    // The whole reason the hardcoded date was replaced: the generated date must
    // stay inside the site's rolling window no matter when the eval runs.
    for (let month = 0; month < 12; month++) {
      for (const day of [1, 15, 28, 31]) {
        const now = new Date(2026, month, day);
        const label = previousMonthFirstDayLabel(now);
        const parsed = new Date(label);
        const daysAgo =
          (now.getTime() - parsed.getTime()) / (1000 * 60 * 60 * 24);
        expect(daysAgo).toBeGreaterThan(0); // never in the future
        expect(daysAgo).toBeLessThanOrEqual(90); // inside the accepted window
      }
    }
  });
});
