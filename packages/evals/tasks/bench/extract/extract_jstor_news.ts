import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { normalizeString } from "../../../scoring.js";

export default defineBenchTask(
  { name: "extract_jstor_news" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/jstor/", {
        waitUntil: "load",
      });
      await stagehand.act("close the cookie");

      const { data: result } = await stagehand.extract(
        "Extract ALL the news report titles and their dates.",
        z.object({
          reports: z.array(
            z.object({
              report_name: z.string().describe("The name or title of the news report."),
              publish_date: z.string().describe("The date the news report was published."),
            }),
          ),
        }),
      );

      const reports = result.reports;
      const expectedReports = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".post-list article")).map((article) => ({
          report_name: article.querySelector(".post-title")?.textContent?.trim() ?? "",
          publish_date: article.querySelector(".meta.date")?.textContent?.trim() ?? "",
        })),
      );
      if (expectedReports.length === 0) {
        throw new Error("Expected JSTOR news reports not found");
      }
      const key = (report: { report_name: string; publish_date: string }) =>
        `${normalizeString(report.report_name)}|${normalizeString(report.publish_date)}`;
      const actualKeys = reports.map(key).sort();
      const expectedKeys = expectedReports.map(key).sort();
      const allReportsMatch =
        actualKeys.length === expectedKeys.length &&
        JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);

      if (!allReportsMatch) {
        logger.error({
          message: "Extracted reports do not match the page",
          level: 0,
          auxiliary: {
            expected: { value: JSON.stringify(expectedReports), type: "object" },
            actual: { value: JSON.stringify(reports), type: "object" },
          },
        });
        return {
          _success: false,
          error: "Extracted reports do not match the page",
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
        error: String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
  },
);
