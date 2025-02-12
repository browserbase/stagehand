import { EvalFunction } from "@/types/evals";

import { normalizeString } from "@/evals/utils";
import { z } from "zod";

export const extract_resistor_info: EvalFunction = async ({
  stagehand,
  modelName,
  logger,
  useTextExtract,
}) => {
  await stagehand.page.goto("https://www.seielect.com/?stockcheck=ASR1JA330R");

  const result = await stagehand.page.extract({
    instruction:
      "Extract the MOQ, tolerance percentage, ohmic value, and operating temperature range of the resistor.",
    schema: z.object({
      moq: z.string(),
      tolerance_percentage: z.string(),
      ohmic_value: z.string(),
      operating_temperature_range: z.string(),
    }),
    modelName,
    useTextExtract,
  });

  await stagehand.close();

  const {
    moq,
    tolerance_percentage,
    ohmic_value,
    operating_temperature_range,
  } = result;

  const expected = {
    moq: "500",
    tolerance_percentage: "5%",
    ohmic_value: "330 ohm",
    operating_temperature_range: "-55 to +155",
  };

  if (normalizeString(moq) !== normalizeString(expected.moq)) {
    logger.error({
      message: "MOQ extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.moq),
          type: "string",
        },
        actual: {
          value: normalizeString(moq),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "MOQ extracted does not match expected",
      logs: logger.getLogs(),
    };
  }

  if (
    normalizeString(tolerance_percentage) !==
    normalizeString(expected.tolerance_percentage)
  ) {
    logger.error({
      message: "Tolerance percentage extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.tolerance_percentage),
          type: "string",
        },
        actual: {
          value: normalizeString(tolerance_percentage),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Tolerance percentage extracted does not match expected",
      logs: logger.getLogs(),
    };
  }

  if (normalizeString(ohmic_value) !== normalizeString(expected.ohmic_value)) {
    logger.error({
      message: "Ohmic value extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.ohmic_value),
          type: "string",
        },
        actual: {
          value: normalizeString(ohmic_value),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Ohmic value extracted does not match expected",
      logs: logger.getLogs(),
    };
  }

  if (
    normalizeString(operating_temperature_range) !==
    normalizeString(expected.operating_temperature_range)
  ) {
    logger.error({
      message: "Operating temperature range extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.operating_temperature_range),
          type: "string",
        },
        actual: {
          value: normalizeString(operating_temperature_range),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Operating temperature range extracted does not match expected",
      logs: logger.getLogs(),
    };
  }

  return {
    _success: true,
    logs: logger.getLogs(),
  };
};
