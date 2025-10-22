import { z } from "zod";
import { EvalFunction } from "../types/evals";

export const extract_snowshoeing_destinations: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://www.cbisland.com/blog/10-snowshoeing-adventures-on-cape-breton-island/",
    );

    await v3.act("accept the cookies");

    const snowshoeing_regions = await v3.extract(
      "Extract all the snowshoeing regions and the names of the trails within each region.",
      z.object({
        snowshoeing_regions: z.array(
          z.object({
            region_name: z
              .string()
              .describe("The name of the snowshoeing region"),
            trails: z
              .array(
                z.object({
                  trail_name: z.string().describe("The name of the trail"),
                }),
              )
              .describe("The list of trails available in this region."),
          }),
        ),
      }),
    );

    logger.log({
      message: "Extracted destinations and trails",
      level: 1,
      auxiliary: {
        destinations: {
          value: JSON.stringify(snowshoeing_regions),
          type: "object",
        },
      },
    });

    const _success = snowshoeing_regions.snowshoeing_regions.length === 10;

    return {
      _success,
      snowshoeing_regions,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    logger.error({
      message: "Error in extract_snowshoeing_destinations function",
      level: 0,
      auxiliary: {
        error: {
          value: error.message,
          type: "string",
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
