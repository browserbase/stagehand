import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "extract_github_commits" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://github.com/facebook/react");
      await stagehand.act("find commit history, generally described by the number of commits");

      const { data } = await stagehand.extract(
        "Extract the last 20 commits",
        z.object({
          commits: z.array(
            z.object({
              commit_message: z.string(),
              commit_url: z.string(),
              commit_hash: z.string(),
            }),
          ),
        }),
      );

      return {
        _success: data.commits.length === 20,
        commits: data.commits,
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
