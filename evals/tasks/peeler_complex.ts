import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const peeler_complex: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(`https://chefstoys.com/`, { timeout: 60000 });
    await stagehand.page.waitForLoadState("networkidle");

    await stagehand.page.act("find the button to close the popup");
    await stagehand.page.act({
      action: "search for %search_query%",
      variables: {
        search_query: "peeler",
      },
    });

    await stagehand.page.act({
      action: 'click on the first "OXO" brand peeler',
    });

    const { price } = await stagehand.page.extract({
      instruction: "get the price of the peeler",
      schema: z.object({ price: z.number().nullable() }),
    });

    return {
      _success: price === 11.99,
      price,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "error in peeler_complex function",
      level: 0,
      auxiliary: {
        error: {
          value: JSON.stringify(error, null, 2),
          type: "object",
        },
        trace: {
          value: error.stack,
          type: "string",
        },
      },
    });

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
