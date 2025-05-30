import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const extract_collaborators: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto("https://github.com/facebook/react");
    await stagehand.page.act({
      action: "find and click the contributors section",
    });

    await stagehand.page.waitForLoadState("domcontentloaded");
    await stagehand.page.waitForLoadState("networkidle");
    await stagehand.page.waitForTimeout(5000);

    const { contributors } = await stagehand.page.extract({
      instruction: "Extract top 5 contributors of this repository",
      schema: z.object({
        contributors: z.array(
          z.object({
            github_username: z
              .string()
              .describe("the github username of the contributor"),
            commits: z.number().describe("number of commits contributed"),
          }),
        ),
      }),
    });

    await stagehand.close();

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
    console.error("Error or timeout occurred:", error);

    await stagehand.close();

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
