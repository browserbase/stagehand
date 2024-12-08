import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";
import { normalizeString } from "../utils";
import { z } from "zod";

export const extract_nhl_stats: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 4000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.hockeydb.com/ihdb/stats/top_league.php?lid=nhl1927&sid=1990", {
    waitUntil: "domcontentloaded",
  });

  const result = await stagehand.extract({
    instruction: "Extract the name of the goal scoring leader, their number of goals they scored, and the team they played for.",
    schema: z.object({
      name: z.string(),
      num_goals: z.string(),
      team: z.string(),
    }),
    modelName,
  });

  await stagehand.close();

  const { name, num_goals, team } = result;

  const expected = {
    name: "Brett Hull",
    num_goals: "72",
    team: "St. Louis",
  };

  if (normalizeString(name) !== normalizeString(expected.name)) {
    logger.error({
      message: "Player name extracted does not match expected",
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
      error: "Player name extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (normalizeString(num_goals) !== normalizeString(expected.num_goals)) {
    logger.error({
      message: "Number of goals extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.num_goals),
          type: "string",
        },
        actual: {
          value: normalizeString(num_goals),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Number of goals extracted does not match expected",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (normalizeString(team) !== normalizeString(expected.team)) {
    logger.error({
      message: "Player team extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: normalizeString(expected.team),
          type: "string",
        },
        actual: {
          value: normalizeString(team),
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Player team extracted does not match expected",
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
