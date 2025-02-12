import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const extract_collaborators: EvalFunction = async ({
  stagehand,
  modelName,
  logger,
  useTextExtract,
}) => {
  try {
    await stagehand.page.goto("https://github.com/facebook/react");
    await stagehand.page.act({
      action: "find the contributors section",
    });

    const { contributors } = await stagehand.page.extract({
      instruction: "Extract top 20 contributors of this repository",
      schema: z.object({
        contributors: z.array(
          z.object({
            github_username: z
              .string()
              .describe("the github username of the contributor"),
            information: z.string().describe("number of commits contributed"),
          }),
        ),
      }),
      modelName,
      useTextExtract,
    });

    await stagehand.close();

    return {
      _success: contributors.length === 20,
      contributors,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);

    await stagehand.close();

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      logs: logger.getLogs(),
    };
  }
};
