import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "extract_single_link" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/geniusee/");

      const extraction = await stagehand.extract(
        "extract the link to the 'contact us' page",
        z.object({
          link: z.string().url(),
        }),
      );
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
        error: `Extracted link: ${extractedLink} does not match expected link: ${expectedLink}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
