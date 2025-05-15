import { EvalFunction } from "@/types/evals";

export const expect_act_timeout: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  await stagehand.page.goto("https://docs.stagehand.dev");
  const result = await stagehand.page.act({
    action: "search for 'Stagehand'",
    timeoutMs: 1_000,
  });

  await stagehand.close();

  return {
    _success: !result.success,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
