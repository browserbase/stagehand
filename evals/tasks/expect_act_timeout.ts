import { EvalFunction } from "@/types/evals";

export const expect_act_timeout: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto("https://docs.stagehand.dev");
    const result = await stagehand.page.act({
      action: "search for 'Stagehand'",
      timeoutMs: 1_000,
    });

    return {
      _success: !result.success,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
