import { z } from "zod";
import { initStagehand } from "../utils";
import { EvalFunction } from "../types/evals";
import { normalizeString } from "../utils";

export const extract_memorial_healthcare: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.mycmh.org/locations/");

  const result = await stagehand.extract({
    instruction:
      "extract a list of the first three healthcare centers on this page, with their name, full address, and phone number",
    schema: z.object({
      health_centers: z.array(
        z.object({
          name: z.string(),
          phone_number: z.string(),
          address: z.string(),
        }),
      ),
    }),
  });

  await stagehand.close();

  const health_centers = result.health_centers;

  const expectedLength = 3;

  const expectedFirstItem = {
    name: "Community Memorial Breast Center",
    phone_number: "805-948-5093",
    address: "168 North Brent Street, Suite 401, Ventura, CA 93003",
  };

  const expectedLastItem = {
    name: "Community Memorial Dermatology and Mohs Surgery",
    phone_number: "805-948-6920",
    address: "168 North Brent Street, Suite 403, Ventura, CA 93003",
  };

  if (health_centers.length !== expectedLength) {
    logger.error({
      message: "Incorrect number of health centers extracted",
      level: 0,
      auxiliary: {
        expected: {
          value: expectedLength.toString(),
          type: "integer",
        },
        actual: {
          value: health_centers.length.toString(),
          type: "integer",
        },
      },
    });

    return {
      _success: false,
      error: "Incorrect number of health centers extracted",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  const normalizeAndCompare = (actual, expected) =>
    normalizeString(actual.name) === normalizeString(expected.name) &&
    normalizeString(actual.phone_number) ===
      normalizeString(expected.phone_number) &&
    normalizeString(actual.address) === normalizeString(expected.address);

  if (!normalizeAndCompare(health_centers[0], expectedFirstItem)) {
    logger.error({
      message: "First health center does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedFirstItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(health_centers[0]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "First health center does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (
    !normalizeAndCompare(
      health_centers[health_centers.length - 1],
      expectedLastItem,
    )
  ) {
    logger.error({
      message: "Last health center does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedLastItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(health_centers[health_centers.length - 1]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "Last health center does not match expected",
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
