import { EvalFunction } from "@/types/evals";
import { initStagehand } from "@/evals/initStagehand";

export const extract_github_commits: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://github.com/facebook/react");

    const { extraction } = await stagehand.page.extract(
      "extract the repo name",
    );

    logger.log({
      message: "Extracted repo name",
      level: 1,
      auxiliary: {
        repo_name: {
          value: extraction,
          type: "object",
        },
      },
    });

    await stagehand.close();

    return {
      _success: extraction === "react",
      extraction,
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
