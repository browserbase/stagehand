import { EvalFunction } from "../types/evals";
import { z } from "zod";

export const extract_collaborators: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://github.com/facebook/react");
    await v3.act("find and click the contributors section");

    await v3.act("scroll halfway down the page");

    const { contributors } = await v3.extract(
      "Extract top 5 contributors of this repository",
      z.object({
        contributors: z.array(
          z.object({
            github_username: z
              .string()
              .describe("the github username of the contributor"),
            commits: z.number().describe("number of commits contributed"),
          }),
        ),
      }),
    );

    const EXPECTED_CONTRIBUTORS = [
      "zpao",
      "gaearon",
      "sebmarkbage",
      "acdlite",
      "sophiebits",
    ];
    return {
      _success:
        contributors.length === EXPECTED_CONTRIBUTORS.length &&
        contributors.every(
          (c, i) =>
            EXPECTED_CONTRIBUTORS[i] === c.github_username && c.commits >= 1000,
        ),
      contributors,
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
    await v3.close();
  }
};
