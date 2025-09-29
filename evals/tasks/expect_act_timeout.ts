import { EvalFunction } from "@/lib/v3/types/evals";

export const expect_act_timeout: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://docs.stagehand.dev");
    const result = await v3.act("search for 'Stagehand'", { timeout: 1_000 });

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
    await v3.close();
  }
};
