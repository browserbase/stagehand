import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  startUrl: "https://investors.digitalocean.com",
  goal: "On DigitalOcean's investor relations site, find the earnings press release for the most recent quarter and report: the quarter (e.g. Q2 2026), revenue in millions of USD, year-over-year revenue growth in percent, GAAP net income, adjusted EBITDA, adjusted free cash flow and annual run-rate revenue (all in millions of USD, null if not reported), the revenue guidance range for the next quarter and for the full year (null if not given), and the press release URL.",
  check: (report) =>
    /^Q[1-4] 20\d\d$/.test(report.quarter.trim()) &&
    report.revenueUsdM > 100 &&
    report.releaseUrl.includes("digitalocean.com"),
};
