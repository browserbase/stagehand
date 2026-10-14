import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  startUrl: "https://linear.app/pricing",
  goal: "Visit the pricing pages of Linear (https://linear.app/pricing), Supabase (https://supabase.com/pricing), Vercel (https://vercel.com/pricing) and Render (https://render.com/pricing). Switch to monthly billing where there is a toggle. For each vendor list every plan with its name, monthly price in USD when billed monthly (null for custom pricing) and what the price is per.",
  check: ({ vendors }) =>
    vendors.length === 4 && vendors.every((vendor) => vendor.plans.length >= 2),
};
