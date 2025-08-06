import { EvalFunction } from "@/types/evals";
import { normalizeString } from "@/evals/utils";
import { z } from "zod/v3";

export const extract_capacitor_info: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/capacitor/",
    );

    const result = await stagehand.page.extract({
      instruction: "Extract the ECCN Code, RoHS Status, and Impedance.",
      schema: z.object({
        ECCN_code: z.string(),
        RoHS_Status: z.string(),
        Impedance: z.string(),
      }),
    });

    const { ECCN_code, RoHS_Status, Impedance } = result;

    const expected = {
      ECCN_code: "EAR99",
      RoHS_Status: "RoHS Compliant",
      Impedance: "12mOhm",
    };

    if (normalizeString(ECCN_code) !== normalizeString(expected.ECCN_code)) {
      logger.error({
        message: "ECCN code extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: normalizeString(expected.ECCN_code),
            type: "string",
          },
          actual: {
            value: normalizeString(ECCN_code),
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error: "ECCN code extracted does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    if (
      normalizeString(RoHS_Status) !== normalizeString(expected.RoHS_Status)
    ) {
      logger.error({
        message: "RoHS Status extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: normalizeString(expected.RoHS_Status),
            type: "string",
          },
          actual: {
            value: normalizeString(RoHS_Status),
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error: "RoHS Status extracted does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    if (normalizeString(Impedance) !== normalizeString(expected.Impedance)) {
      logger.error({
        message: "Impedance extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: normalizeString(expected.Impedance),
            type: "string",
          },
          actual: {
            value: normalizeString(Impedance),
            type: "string",
          },
        },
      });
      return {
        _success: false,
        error: "Impedance extracted does not match expected",
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
