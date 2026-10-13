import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const range = z.object({ lowUsdM: z.number(), highUsdM: z.number() }).nullable();

export const schema = z.object({
  quarter: z.string().describe('Fiscal quarter, e.g. "Q2 2026"'),
  revenueUsdM: z.number().describe("Revenue in millions of USD"),
  revenueGrowthYoYPct: z.number().nullable(),
  netIncomeUsdM: z
    .number()
    .nullable()
    .describe("GAAP net income in millions of USD; negative for a loss"),
  adjustedEbitdaUsdM: z.number().nullable(),
  adjustedFreeCashFlowUsdM: z.number().nullable(),
  arrUsdM: z.number().nullable().describe("Annual run-rate revenue in millions of USD"),
  nextQuarterRevenueGuidance: range,
  fullYearRevenueGuidance: range,
  releaseUrl: z.url(),
});

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", 10_000).catch(() => undefined);
}

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  await page.goto("https://investors.digitalocean.com");
  await settle(page);

  await stagehand.act("Open Quarterly Results from the Financials menu", { page });
  await settle(page);

  // Release links open a new window, so read the URL and navigate to it here.
  const { data: latest } = await stagehand.extract(
    'The most recent quarter listed and the link of its "View full release" press release',
    z.object({ quarter: z.string(), releaseUrl: z.url() }),
    { page },
  );
  await page.goto(latest.releaseUrl);
  await settle(page);

  // Figures are spread across prose, highlight bullets and GAAP tables.
  const { data } = await stagehand.extract(
    `The headline results for ${latest.quarter} and the outlook from this earnings release`,
    schema.omit({ releaseUrl: true }),
    { page },
  );
  return { ...data, releaseUrl: latest.releaseUrl };
}
