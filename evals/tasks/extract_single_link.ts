import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";

export const extract_single_link: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/",
    );

    const extraction = await stagehand.page.extract({
      instruction: "extract the link to the 'contact us' page",
      schema: z.object({
        link: z.string().url(),
      }),
    });
    const extractedLink = extraction.link;
    const expectedLink =
      "https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/#contact";

    if (extractedLink === expectedLink) {
      return {
        _success: true,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: false,
      reason: `Extracted link: ${extractedLink} does not match expected link: ${expectedLink}`,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
