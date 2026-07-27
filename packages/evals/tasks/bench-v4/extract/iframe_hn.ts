import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "iframe_hn" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
      );

      // NOTE: the target content lives inside an iframe, but the v3 task
      // relies entirely on extract() to see into it (no frames() API usage),
      // so this ports 1:1 — iframe handling is the SDK's responsibility.
      const result = await stagehand.extract(
        "extract the title of the first hackernews story",
        z.object({
          story_title: z.string(),
        }),
      );

      const title = result.story_title.toLowerCase();
      const expectedTitleSubstring = "overengineered anchor links";

      if (!title.includes(expectedTitleSubstring)) {
        logger.error({
          message: `Extracted title: ${title} does not contain expected substring: ${expectedTitleSubstring}`,
          level: 0,
        });
        return {
          _success: false,
          error: `Extracted title: ${title} does not contain expected substring: ${expectedTitleSubstring}`,
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
