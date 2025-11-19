import { z } from "zod";
import { EvalFunction } from "../types/evals";

export const extract_zillow: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/zillow/",
    );

    const real_estate_listings = await v3.extract(
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

    await v3.close();
    const listings = real_estate_listings.listings;
    const expectedLength = 38;

    if (listings.length < expectedLength) {
      logger.error({
        message: "Incorrect number of listings extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: expectedLength.toString(),
            type: "integer",
          },
          actual: {
            value: listings.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Incorrect number of listings extracted",
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
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await v3.close();
  }
};
