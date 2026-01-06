import { Stagehand } from "../lib/v3";
import { z } from "zod";
import * as fs from "node:fs";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  // await page.goto(
  //   "https://www.cbisland.com/blog/10-snowshoeing-adventures-on-cape-breton-island/",
  // );
  // const companyList = await stagehand.scrape(
  //   "Extract all the snowshoeing regions and the names of the trails within each region.",
  //   z.object({
  //     snowshoeing_regions: z.array(
  //       z.object({
  //         region_name: z
  //           .string()
  //           .describe("The name of the snowshoeing region"),
  //         trails: z
  //           .array(
  //             z.object({
  //               trail_name: z.string().describe("The name of the trail"),
  //             }),
  //           )
  //           .describe("The list of trails available in this region."),
  //       }),
  //     ),
  //   }),
  // );

  // await page.goto(
  //   "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
  // );
  // const companyList = await stagehand.scrape(
  //   "Extract all companies that received the AI grant and group them with their batch numbers as an array of objects. Each object should contain the company name and its corresponding batch number.",
  //   z.object({
  //     companies: z.array(
  //       z.object({
  //         company: z.string(),
  //         batch: z.number(),
  //       }),
  //     ),
  //   }),
  // );

  await page.goto("https://www.apartments.com/san-francisco-ca/2-bedrooms/", {
    waitUntil: "load",
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));
  const apartment_listings = await stagehand.scrape(
    "Extract all the apartment listings with their prices and their addresses.",
    z.object({
      listings: z.array(
        z.object({
          price: z.string().describe("The price of the listing"),
          address: z.string().describe("The address of the listing"),
        }),
      ),
    }),
  );

  fs.writeFileSync(
    "scrapeXpaths.json",
    JSON.stringify(apartment_listings, null, 2),
  );
  console.log(JSON.stringify(apartment_listings, null, 2));

  const resolved = await apartment_listings.resolve();
  fs.writeFileSync("resolvedScrape.json", JSON.stringify(resolved, null, 2));
  console.log(JSON.stringify(resolved, null, 2));

  await new Promise((resolve) => setTimeout(resolve, 1000));
  console.log(await stagehand.metrics);
  console.log(resolved.listings.length);

  // const text = await page.locator("/html[1]/body[1]/div[1]/text()[normalize-space()][5]").textContent()
  // console.log(text)
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    model: "anthropic/claude-haiku-4-5",
    logInferenceToFile: true,
    cacheDir: "scrape-cache-2",
  });
  await stagehand.init();
  await example(stagehand);
})();
