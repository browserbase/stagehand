import { EvalFunction } from "@/types/evals";

export const nonsense_action: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://www.homedepot.com/");

    const result = await stagehand.page.act({
      action: "what is the capital of the moon?",
    });

    return {
      _success: !result.success, // We expect this to fail
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
