import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "extract_geniusee" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/",
      );
      // NOTE: v3 passes a bare XPath here; ported verbatim on purpose.
      const selector = "/html/body/main/div[2]/div[2]/div[2]/table";
      const scalability = await stagehand.extract(
        "Extract the scalability comment in the table for Gemini (Google)",
        z.object({
          scalability: z.string(),
        }),
        { selector: selector },
      );

      const scalabilityComment = scalability.scalability;

      const expectedScalabilityComment = {
        scalability: "Scalable architecture with API access",
      };

      const commentMatches =
        scalabilityComment == expectedScalabilityComment.scalability;

      if (!commentMatches) {
        logger.error({
          message: "extracted scalability comment does not match expected",
          level: 0,
          auxiliary: {
            expected: {
              value: expectedScalabilityComment.scalability,
              type: "string",
            },
            actual: {
              value: scalabilityComment,
              type: "string",
            },
          },
        });
        return {
          _success: false,
          error: "extracted scalability comment does not match expected",
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
  },
);
