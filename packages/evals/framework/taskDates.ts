/**
 * Date helpers for bench tasks whose target site only accepts inputs inside a
 * rolling window. A hardcoded date in a task instruction silently rots: it stays
 * valid for a while, then drifts out of the site's accepted range and the task
 * becomes unsatisfiable — failing as if the agent were at fault.
 */

/**
 * The first day of the previous month, formatted for a task instruction, e.g.
 * "Jun 1, 2026".
 *
 * Used by `agent/webmd_ovulation_calculator`: WebMD's ovulation calculator only
 * accepts a last-period start date within roughly the past 90 days, so the
 * task's original hardcoded "Mar 1" became task-invalid once >90 days elapsed.
 * The first of the previous month is always in range (at most ~62 days ago) and
 * never in the future.
 *
 * Two edge cases this deliberately handles:
 *  - **Month-end overflow.** Pin the day to 1 *before* shifting the month.
 *    Mutating a Mar 31 date with `setMonth(month - 1)` would ask for "Feb 31"
 *    and overflow forward into March. Constructing the date from parts avoids
 *    that entirely.
 *  - **January → prior year.** In January the previous month is December of the
 *    *previous* year; a month index of -1 correctly rolls the year back. The
 *    year is included in the label because a year-less "Dec 1" would read as
 *    ~11 months in the *future*.
 */
export function previousMonthFirstDayLabel(now: Date = new Date()): string {
  const firstOfPreviousMonth = new Date(
    now.getFullYear(),
    now.getMonth() - 1,
    1,
  );
  return firstOfPreviousMonth.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
