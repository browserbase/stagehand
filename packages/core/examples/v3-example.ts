import { Stagehand } from "../lib/v3/index.js";
import { z } from "zod";

async function example(stagehand: Stagehand) {
  const page = stagehand.context.pages()[0];
  await page.goto("https://www.apartments.com/san-francisco-ca/2-bedrooms/", {
    waitUntil: "load",
  });
  const apartment_listings = await stagehand.extract(
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

  const listings = apartment_listings.listings;
  console.log(listings);
  console.log(`found ${listings.length} listings`);
}

(async () => {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2,
    logInferenceToFile: false,
    model: "google/gemini-2.0-flash",
    cacheDir: "stagehand-extract-cache",
  });
  await stagehand.init();
  await example(stagehand);
})();
