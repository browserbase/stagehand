import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "extract_geniusee_2" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/",
      );
      // NOTE: v3 passes a bare XPath here; ported verbatim on purpose.
      const selector = "/html/body/main/div[2]/div[2]/div[2]/table/tbody/tr[9]";
      const scalability = await stagehand.extract(
        "Extract the scalability comment in the table for Gemini (Google)",
        z.object({
          scalability: z.string(),
        }),
        { selector: selector },
      );

      const scalabilityComment = scalability.scalability;

      // scalabilityCommentWeShouldNotGet matches a scalability comment in the table,
      // but since we are using targeted_extract here,
      // and passing in a selector that does NOT contain the scalabilityCommentWeShouldNotGet,
      // the LLM should have no visibility into scalabilityCommentWeShouldNotGet if
      // targeted_extract is performing correctly
      const scalabilityCommentWeShouldNotGet = {
        scalability: "Scalable architecture with API access",
      };

      const commentMatches =
        scalabilityComment == scalabilityCommentWeShouldNotGet.scalability;

      if (commentMatches) {
        logger.error({
          message:
            "extracted scalability comment matches the scalability comment that we SHOULD NOT get",
          level: 0,
          auxiliary: {
            expected: {
              value: scalabilityCommentWeShouldNotGet.scalability,
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
          error:
            "scalability comment matches the scalability comment that we SHOULD NOT get",
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
