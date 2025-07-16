import { EvalFunction } from "@/types/evals";

export const extract_repo_name: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://github.com/facebook/react");

    const { extraction } = await stagehand.page.extract(
      "extract the title of the Github repository. Do not include the owner of the repository.",
    );

    logger.log({
      message: "Extracted repo title",
      level: 1,
      auxiliary: {
        repo_name: {
          value: extraction,
          type: "object",
        },
      },
    });

    return {
      _success: extraction === "react",
      extraction,
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
