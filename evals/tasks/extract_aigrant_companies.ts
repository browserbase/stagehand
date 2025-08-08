import { z } from "zod/v3";
import { EvalFunction } from "@/types/evals";

export const extract_aigrant_companies: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
    );
    const companyList = await stagehand.page.extract({
      instruction:
        "Extract all companies that received the AI grant and group them with their batch numbers as an array of objects. Each object should contain the company name and its corresponding batch number.",
      schema: z.object({
        companies: z.array(
          z.object({
            company: z.string(),
            batch: z.string(),
          }),
        ),
      }),
    });
    const companies = companyList.companies;
    const expectedLength = 91;

    const expectedFirstItem = {
      company: "Goodfire",
      batch: "4",
    };

    const expectedLastItem = {
      company: "Forefront",
      batch: "1",
    };

    if (companies.length !== expectedLength) {
      logger.error({
        message: "Incorrect number of companies extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: expectedLength.toString(),
            type: "integer",
          },
          actual: {
            value: companies.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Incorrect number of companies extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
    const firstItemMatches =
      companies[0].company === expectedFirstItem.company &&
      companies[0].batch === expectedFirstItem.batch;

    if (!firstItemMatches) {
      logger.error({
        message: "First company extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedFirstItem),
            type: "object",
          },
          actual: {
            value: JSON.stringify(companies[0]),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "First company extracted does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const lastItemMatches =
      companies[companies.length - 1].company === expectedLastItem.company &&
      companies[companies.length - 1].batch === expectedLastItem.batch;

    if (!lastItemMatches) {
      logger.error({
        message: "Last company extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedLastItem),
            type: "object",
          },
          actual: {
            value: JSON.stringify(companies[companies.length - 1]),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "Last company extracted does not match expected",
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
