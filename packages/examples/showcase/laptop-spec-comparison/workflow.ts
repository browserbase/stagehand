import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

const QUERY = "laptops 16gb ram";

const specs = z.object({
  name: z.string(),
  price: z.number().describe("Current price in USD"),
  processor: z.string(),
  ramGb: z.number(),
  storageGb: z.number(),
  screenInches: z.number(),
  weightLbs: z.number().nullable(),
});

export const schema = z.object({
  laptops: z.array(specs.extend({ url: z.url() })),
});

async function settle(page: Page) {
  await page.waitForLoadState("networkidle", 10_000).catch(() => undefined);
}

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  await page.goto(
    `https://www.staples.com/${encodeURIComponent(QUERY)}/directory_${encodeURIComponent(QUERY)}`,
  );
  await settle(page);

  // Only the first row renders up front; the rest of the grid loads on scroll.
  for (let i = 1; i <= 2; i++) {
    await page.evaluate(`window.scrollTo(0, document.body.scrollHeight * ${i / 5})`);
    await settle(page);
  }

  // Sponsored tiles look like organic results apart from a small label.
  const { data: results } = await stagehand.extract(
    "The first five laptops in the search results that are not labeled sponsored, each a different product with its own product page",
    z.object({ products: z.array(z.object({ name: z.string(), url: z.url() })) }),
    { page },
  );

  const laptops = [];
  for (const product of results.products.slice(0, 3)) {
    await page.goto(product.url);
    await settle(page);
    // Specs sit behind a tab below the fold and only render once it is opened.
    await stagehand.act("Click the Specifications tab", { page });
    const { data } = await stagehand.extract("The laptop's current price and key specs", specs, {
      page,
    });
    laptops.push({ ...data, url: product.url });
  }

  return { laptops };
}
