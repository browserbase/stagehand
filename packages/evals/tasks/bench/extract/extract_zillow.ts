import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { normalizeString } from "../../../framework/textScoring.js";

export default defineBenchTask(
  { name: "extract_zillow" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/zillow/");

      const { data: real_estate_listings } = await stagehand.extract(
        "Extract EACH AND EVERY HOME PRICE AND ADDRESS ON THE PAGE. DO NOT MISS ANY OF THEM.",
        z.object({
          listings: z.array(
            z.object({
              price: z.string().describe("The price of the home"),
              trails: z.string().describe("The address of the home"),
            }),
          ),
        }),
      );

      const listings = real_estate_listings.listings;
      const expectedListings = await page.evaluate(() =>
        Array.from(document.querySelectorAll('[data-test="property-card"]')).flatMap((card) => {
          const price = card
            .querySelector('[data-test="property-card-price"]')
            ?.textContent?.trim();
          const trails = card.querySelector("address")?.textContent?.trim();
          return price && trails ? [{ price, trails }] : [];
        }),
      );
      const key = (listing: { price: string; trails: string }) =>
        `${normalizeString(listing.price)}|${normalizeString(listing.trails)}`;
      const actualKeys = listings.map(key).sort();
      const expectedKeys = expectedListings.map(key).sort();
      const allListingsMatch =
        actualKeys.length === expectedKeys.length &&
        JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);

      if (!allListingsMatch) {
        logger.error({
          message: "Extracted listings do not match the page",
          level: 0,
          auxiliary: {
            expected: { value: JSON.stringify(expectedListings), type: "object" },
            actual: { value: JSON.stringify(listings), type: "object" },
          },
        });
        return {
          _success: false,
          error: "Extracted listings do not match the page",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }

      return {
        _success: true,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } catch (error) {
      return {
        _success: false,
        error: String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } finally {
      await stagehand.close();
    }
  },
);
