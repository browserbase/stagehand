import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { normalizeString } from "../utils";
import { z } from "zod";

export const extract_baptist_health: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto(
    "https://www.baptistfirst.org/location/baptist-health-ent-partners",
  );

  const result = await stagehand.extract({
    instruction:
      "Extract the address, phone number, and fax number of the healthcare location.",
    schema: z.object({
      address: z.string(),
      phone: z.string(),
      fax: z.string(),
    }),
    modelName,
  });

  await stagehand.close();

  const { address, phone, fax } = result;

  const expected = {
    address: "2055 East South Blvd; Suite 908 Montgomery, AL 36116",
    phone: "334-747-2273",
    fax: "334-747-7501",
  };

  if (normalizeString(address) !== normalizeString(expected.address)) {
    logger.error({
      message: "Address extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: expected.address,
          type: "string",
        },
        actual: {
          value: address,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Address extracted does not match expected",
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
          value: expected.phone,
          type: "string",
        },
        actual: {
          value: phone,
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
          value: expected.fax,
          type: "string",
        },
        actual: {
          value: fax,
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
