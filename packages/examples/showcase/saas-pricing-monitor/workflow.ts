import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const VENDORS = [
  { vendor: "Linear", url: "https://linear.app/pricing" },
  { vendor: "Supabase", url: "https://supabase.com/pricing" },
  { vendor: "Vercel", url: "https://vercel.com/pricing" },
  { vendor: "Render", url: "https://render.com/pricing" },
];

const plans = z.object({
  plans: z.array(
    z.object({
      name: z.string(),
      monthlyUsd: z.number().nullable().describe("Monthly price billed monthly; null if custom"),
      unit: z.string().nullable().describe('What the price is per, e.g. "per user"'),
    }),
  ),
});

export const schema = z.object({
  vendors: z.array(plans.extend({ vendor: z.string() })),
});

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  const vendors = [];
  for (const { vendor, url } of VENDORS) {
    await page.goto(url);
    // Some pages default to annual billing, which changes every number.
    const { data: billing } = await stagehand.extract(
      "Whether the prices shown are billed annually, with a control to switch to monthly",
      z.object({ annualWithMonthlyToggle: z.boolean() }),
      { page },
    );
    if (billing.annualWithMonthlyToggle) {
      await stagehand.act("Switch the pricing to monthly billing", { page });
    }

    // Run this on a schedule with caching on: unchanged pages are served from
    // the cache, so a daily check costs almost nothing until a price moves.
    const { data } = await stagehand.extract("Every pricing plan on this page", plans, { page });
    vendors.push({ vendor, ...data });
  }
  return { vendors };
}
