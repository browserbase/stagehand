import { z } from "zod";
import { EvalFunction } from "../types/evals";

export const extract_geniusee_2: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/",
    );
    const selector = "/html/body/main/div[2]/div[2]/div[2]/table/tbody/tr[9]";
    const scalability = await v3.extract(
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
    await v3.close();
  }
};
