import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const extract_jstor_news: EvalFunction = async ({
  logger,

  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/jstor/",
      {
        waitUntil: "load",
      },
    );
    await stagehand.page.act({ action: "close the cookie" });

    const result = await stagehand.page.extract({
      instruction: "Extract ALL the news report titles and their dates.",
      schema: z.object({
        reports: z.array(
          z.object({
            report_name: z
              .string()
              .describe("The name or title of the news report."),
            publish_date: z
              .string()
              .describe("The date the news report was published."),
          }),
        ),
      }),
    });

    const reports = result.reports;
    const expectedLength = 10;

    const expectedFirstItem = {
      report_name: "JSTOR retires Publisher Sales Service",
      publish_date: "December 9, 2024",
    };

    const expectedLastItem = {
      report_name: "Path to Open announces 2024 titles",
      publish_date: "May 10, 2024",
    };

    if (reports.length !== expectedLength) {
      logger.error({
        message: "Incorrect number of reports extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: expectedLength.toString(),
            type: "integer",
          },
          actual: {
            value: reports.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Incorrect number of reports extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
    const firstItemMatches =
      reports[0].report_name === expectedFirstItem.report_name &&
      reports[0].publish_date === expectedFirstItem.publish_date;

    if (!firstItemMatches) {
      logger.error({
        message: "First report extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedFirstItem),
            type: "object",
          },
          actual: {
            value: JSON.stringify(reports[0]),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "First report extracted does not match expected",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const lastItemMatches =
      reports[reports.length - 1].report_name ===
        expectedLastItem.report_name &&
      reports[reports.length - 1].publish_date ===
        expectedLastItem.publish_date;

    if (!lastItemMatches) {
      logger.error({
        message: "Last report extracted does not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedLastItem),
            type: "object",
          },
          actual: {
            value: JSON.stringify(reports[reports.length - 1]),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "Last report extracted does not match expected",
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
