import { EvalFunction } from "@/types/evals";
import { normalizeString } from "@/evals/utils";
import { z } from "zod/v3";

export const extract_nhl_stats: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://www.hockeydb.com/ihdb/stats/top_league.php?lid=nhl1927&sid=1990",
      {
        waitUntil: "domcontentloaded",
      },
    );

    const result = await stagehand.page.extract({
      instruction:
        "Extract the name of the goal scoring leader, their number of goals they scored, and the team they played for.",
      schema: z.object({
        name: z.string(),
        num_goals: z.string(),
        team: z.string(),
      }),
    });

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
            value: normalizeString(expected.name),
            type: "string",
          },
          actual: {
            value: normalizeString(name),
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
