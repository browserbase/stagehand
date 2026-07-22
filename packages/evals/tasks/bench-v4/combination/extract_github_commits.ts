import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "extract_github_commits" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://github.com/facebook/react");

      await page.act(
        "find commit history, generally described by the number of commits",
      );
      const { commits } = await page.extract(
        "Extract last 20 commits",
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

      logger.log({
        message: "Extracted commits",
        level: 1,
        auxiliary: {
          commits: {
            value: JSON.stringify(commits),
            type: "object",
          },
        },
      });

      return {
        _success: commits.length === 20,
        commits,
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
  },
);
