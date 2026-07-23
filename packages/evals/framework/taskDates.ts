/**
 * Date helpers for bench tasks whose target site only accepts inputs inside a
 * rolling window. A hardcoded date in an instruction silently rots: it stays valid
 * for a while, then drifts out of range and the task becomes unsatisfiable —
 * failing as if the agent were at fault.
 */

/**
 * First day of the previous month, formatted for an instruction ("Jun 1, 2026").
 * Always ≤ ~62 days ago and never in the future, which keeps
 * `agent/webmd_ovulation_calculator` inside WebMD's ~90-day accepted range (its
 * original hardcoded "Mar 1" went task-invalid once 90 days elapsed).
 *
 * Built from parts so a Mar 31 `now` can't overflow into "Feb 31". The year is in
 * the label because a year-less "Dec 1" would read as ~11 months in the future.
 */
export function previousMonthFirstDayLabel(now: Date = new Date()): string {
  const firstOfPreviousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return firstOfPreviousMonth.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
