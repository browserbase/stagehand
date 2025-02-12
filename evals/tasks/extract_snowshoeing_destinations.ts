import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const extract_snowshoeing_destinations: EvalFunction = async ({
  stagehand,
  modelName,
  logger,
  useTextExtract,
}) => {
  try {
    await stagehand.page.goto(
      "https://www.wta.org/go-outside/seasonal-hikes/winter-destinations/sno-parks",
    );

    const result = await stagehand.page.extract({
      instruction: "Extract all the snowshoeing destinations",
      schema: z.object({
        destinations: z.array(
          z.object({
            name: z.string().describe("name of the destination"),
            description: z
              .string()
              .describe("description of the destination")
              .nullable(),
            region: z
              .string()
              .describe("region where the destination is located")
              .nullable(),
          }),
        ),
      }),
      modelName,
      useTextExtract,
    });

    const destinations = result.destinations;

    const expectedDestinations = [
      "Cabin Creek Sno-Park",
      "Crystal Springs Sno-Park",
      "Gold Creek Sno-Park",
      "Hyak Sno-Park",
      "Lake Easton Sno-Park",
      "Lake Wenatchee State Park",
      "Mount Spokane State Park",
      "Paradise",
      "Price Creek Sno-Park",
      "Salmon La Sac Sno-Park",
      "Skyline Lake",
      "Swauk Creek",
      "White Pass",
    ];

    const foundDestinations = destinations.map((d) => d.name);

    const allExpectedDestinationsFound = expectedDestinations.every((d) =>
      foundDestinations.includes(d),
    );

    return {
      _success: allExpectedDestinationsFound,
      destinations,
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
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.context.close().catch(() => {});
  }
};
