import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { normalizeString } from "../utils";
import { z } from "zod";

export const extract_coronavirus_stats: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 4000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.worldometers.info/coronavirus/");

  const result = await stagehand.extract({
    instruction:
      "Extract the total number of coronavirus cases, deaths, and recovered cases displayed on the page.",
    schema: z.object({
      cases: z.string(),
      deaths: z.string(),
      recovered: z.string(),
    }),
    modelName,
  });

  await stagehand.close();

  const { cases, deaths, recovered } = result;

  const expected = {
    cases: "704,753,890",
    deaths: "7,010,681",
    recovered: "675,619,811",
  };

  if (normalizeString(cases) !== normalizeString(expected.cases)) {
    logger.error({
      message: "Total cases extracted do not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.cases),
          type: "string",
        },
        actual: {
          value: normalizeString(cases),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Total cases extracted do not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (normalizeString(deaths) !== normalizeString(expected.deaths)) {
    logger.error({
      message: "Total deaths extracted do not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.deaths),
          type: "string",
        },
        actual: {
          value: normalizeString(deaths),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Total deaths extracted do not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (normalizeString(recovered) !== normalizeString(expected.recovered)) {
    logger.error({
      message: "Total recovered cases extracted do not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.recovered),
          type: "string",
        },
        actual: {
          value: normalizeString(recovered),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Total recovered cases extracted do not match expected",
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
