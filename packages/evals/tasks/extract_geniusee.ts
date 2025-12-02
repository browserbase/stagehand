import { z } from "zod";
import { EvalFunction } from "../types/evals";

export const extract_geniusee: EvalFunction = async ({
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
    const selector = "/html/body/main/div[2]/div[2]/div[2]/table";
    const scalability = await v3.extract(
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
    await v3.close();
  }
};
