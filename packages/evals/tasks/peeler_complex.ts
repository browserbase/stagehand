import { EvalFunction } from "../types/evals";
import { z } from "zod";

export const peeler_complex: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(`https://chefstoys.com/`, { timeoutMs: 60000 });
    await page.waitForLoadState("networkidle");

    await v3.act("find the button to close the popup");
    await v3.act("search for %search_query%", {
      variables: {
        search_query: "peeler",
      },
    });

    await v3.act('click on the first "OXO" brand peeler');

    const { price } = await v3.extract(
      "get the price of the peeler",
      z.object({ price: z.number().nullable() }),
    );

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
    await v3.close();
  }
};
