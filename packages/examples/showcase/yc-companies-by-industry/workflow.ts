import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const INDUSTRY = "developer-tools";
const TARGET = 30;

export const schema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      oneLiner: z.string(),
      location: z.string().nullable(),
      batch: z.string().describe("e.g. Winter 2024, Summer 2025"),
    }),
  ),
});

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  await page.goto(`https://www.ycombinator.com/companies/industry/${INDUSTRY}`);
  // The directory renders client-side; wait for the first company card.
  await page.waitForSelector('a[href^="/companies/"]', { timeout: 20_000 });

  const { data } = await stagehand.extract(
    `The first ${TARGET} companies in the list, with the batch shown on each card`,
    schema,
    { page },
  );
  return { companies: data.companies.slice(0, TARGET) };
}
