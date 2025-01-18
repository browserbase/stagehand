import { z } from "zod";
import { initStagehand } from "../initStagehand";
import { EvalFunction } from "../../types/evals";

export const extract_zillow: EvalFunction = async ({
  modelName,
  logger,
  useTextExtract,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
    configOverrides: {
      debugDom: false,
    },
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://zillow-eval.surge.sh/");
  // timeout for 5 seconds
  await stagehand.page.waitForTimeout(5000);
  const real_estate_listings = await stagehand.page.extract({
    instruction:
      "Extract EACH AND EVERY HOME PRICE AND ADDRESS ON THE PAGE. DO NOT MISS ANY OF THEM.",
    schema: z.object({
      listings: z.array(
        z.object({
          price: z.string().describe("The price of the home"),
          trails: z.string().describe("The address of the home"),
        }),
      ),
    }),
    modelName,
    useTextExtract,
  });

  await stagehand.close();
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
};