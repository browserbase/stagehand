import { z } from "zod";
import { EvalFunction } from "../types/evals";

export const extract_apartments: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.apartments.com/san-francisco-ca/2-bedrooms/", {
      waitUntil: "load",
    });
    const apartment_listings = await v3.extract(
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
    const expectedLength = 40;

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
