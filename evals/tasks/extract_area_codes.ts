import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const extract_area_codes: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/ncc-area-codes/",
      { waitUntil: "domcontentloaded" },
    );

    const result = await stagehand.page.extract({
      instruction:
        "Extract ALL the Primary Center names and their corresponding Area Code, and the name of their corresponding Zone.",
      schema: z.object({
        primary_center_list: z.array(
          z.object({
            zone_name: z
              .string()
              .describe(
                "The name of the Zone that the Primary Center is in. For example, 'North Central Zone'.",
              ),
            primary_center_name: z
              .string()
              .describe(
                "The name of the Primary Center. I.e., this is the name of the city or town.",
              ),
            area_code: z
              .string()
              .describe(
                "The area code for the Primary Center. This will either be 2 or 3 digits.",
              ),
          }),
        ),
      }),
    });

    const primaryCenterList = result.primary_center_list;
    const expectedLength = 56;

    const expectedFirstItem = {
      zone_name: "Lagos Zone",
      primary_center_name: "Lagos",
      area_code: "01",
    };

    const expectedLastItem = {
      zone_name: "South-East",
      primary_center_name: "Yenagoa",
      area_code: "089",
    };

    if (primaryCenterList.length !== expectedLength) {
      logger.error({
        message: "Incorrect number of primary centers extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: expectedLength.toString(),
            type: "integer",
          },
          actual: {
            value: primaryCenterList.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Incorrect number of primary centers extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
    const firstItemMatches =
      primaryCenterList[0].zone_name === expectedFirstItem.zone_name &&
      primaryCenterList[0].primary_center_name ===
        expectedFirstItem.primary_center_name &&
      primaryCenterList[0].area_code === expectedFirstItem.area_code;

    if (!firstItemMatches) {
      logger.error({
        message: "First primary center extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedFirstItem),
            type: "object",
          },
          actual: {
            value: JSON.stringify(primaryCenterList[0]),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "First primary center extracted does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const lastItemMatches =
      primaryCenterList[primaryCenterList.length - 1].zone_name ===
        expectedLastItem.zone_name &&
      primaryCenterList[primaryCenterList.length - 1].primary_center_name ===
        expectedLastItem.primary_center_name &&
      primaryCenterList[primaryCenterList.length - 1].area_code ===
        expectedLastItem.area_code;

    if (!lastItemMatches) {
      logger.error({
        message: "Last primary center extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedLastItem),
            type: "object",
          },
          actual: {
            value: JSON.stringify(
              primaryCenterList[primaryCenterList.length - 1],
            ),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "Last primary center extracted does not match expected",
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
    await stagehand.close();
  }
};
