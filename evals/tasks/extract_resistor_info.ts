import { EvalFunction } from "@/types/evals";
import { normalizeString } from "@/evals/utils";
import { z } from "zod/v3";

export const extract_resistor_info: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/resistor/",
    );

    const result = await stagehand.page.extract({
      instruction:
        "Extract the manufacturer standard lead time, tolerance percentage, resistance, and operating temperature range of the resistor.",
      schema: z.object({
        manufacturer_standard_lead_time: z.string(),
        tolerance_percentage: z.string(),
        resistance: z.string(),
        operating_temperature_range: z.string(),
      }),
    });

    const {
      manufacturer_standard_lead_time,
      tolerance_percentage,
      resistance,
      operating_temperature_range,
    } = result;

    const expected = {
      manufacturer_standard_lead_time: "11 Weeks",
      tolerance_percentage: "±5",
      resistance: "330 ohms",
      operating_temperature_range: "-55°C ~ 155°C",
    };

    if (
      normalizeString(manufacturer_standard_lead_time) !==
      normalizeString(expected.manufacturer_standard_lead_time)
    ) {
      logger.error({
        message:
          "manufacturer standard lead time extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: normalizeString(expected.manufacturer_standard_lead_time),
            type: "string",
          },
          actual: {
            value: normalizeString(manufacturer_standard_lead_time),
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error:
          "manufacturer standard lead time extracted does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
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
        debugUrl,
        sessionUrl,
      };
    }

    if (normalizeString(resistance) !== normalizeString(expected.resistance)) {
      logger.error({
        message: "resistance extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: normalizeString(expected.resistance),
            type: "string",
          },
          actual: {
            value: normalizeString(resistance),
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error: "resistance extracted does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    if (
      normalizeString(operating_temperature_range) !==
      normalizeString(expected.operating_temperature_range)
    ) {
      logger.error({
        message:
          "Operating temperature range extracted does not match expected",
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
