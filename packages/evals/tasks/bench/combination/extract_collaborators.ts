import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

const EXPECTED_CONTRIBUTORS = ["zpao", "gaearon", "sebmarkbage", "acdlite", "sophiebits"];

export default defineBenchTask(
  { name: "extract_collaborators" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://github.com/facebook/react");
      await stagehand.act("find and click the contributors section");
      await stagehand.act("scroll halfway down the page");

      const { data } = await stagehand.extract(
        "Extract the top 5 contributors of this repository",
        z.object({
          contributors: z.array(
            z.object({
              github_username: z.string().describe("The contributor's GitHub username"),
              commits: z.number().describe("The number of commits contributed"),
            }),
          ),
        }),
      );

      const success =
        data.contributors.length === EXPECTED_CONTRIBUTORS.length &&
        data.contributors.every(
          (contributor, index) =>
            contributor.github_username === EXPECTED_CONTRIBUTORS[index] &&
            contributor.commits >= 1000,
        );

      return {
        _success: success,
        contributors: data.contributors,
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
