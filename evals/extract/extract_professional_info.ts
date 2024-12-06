import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { normalizeString } from "../utils";
import { z } from "zod";

export const extract_professional_info: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.paulweiss.com/professionals/partners-and-counsel/brian-bolin");

  const result = await stagehand.extract({
    instruction: "Extract the list of Practices, phone number, and fax number of the professional.",
    schema: z.object({
      practices: z.array(z.string()),
      phone: z.string(),
      fax: z.string(),
    }),
    modelName,
  });

  await stagehand.close();

  const { practices, phone, fax } = result;

  const expected = {
    practices: [
      "Restructuring",
      "Finance",
      "Hybrid Capital & Special Situations",
    ],
    phone: "+1-212-373-3262",
    fax: "+1-212-492-0262",
  };

  if (
    JSON.stringify(practices.map(normalizeString)) !==
    JSON.stringify(expected.practices.map(normalizeString))
  ) {
    logger.error({
      message: "Practices extracted do not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expected.practices),
          type: "array",
        },
        actual: {
          value: JSON.stringify(practices),
          type: "array",
        },
      },
    });
    return {
      _success: false,
      error: "Practices extracted do not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (normalizeString(phone) !== normalizeString(expected.phone)) {
    logger.error({
      message: "Phone number extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.phone),
          type: "string",
        },
        actual: {
          value: normalizeString(phone),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Phone number extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (normalizeString(fax) !== normalizeString(expected.fax)) {
    logger.error({
      message: "Fax number extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.fax),
          type: "string",
        },
        actual: {
          value: normalizeString(fax),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Fax number extracted does not match expected",
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
