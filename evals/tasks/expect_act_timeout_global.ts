import { initStagehand } from "@/evals/initStagehand";
import { EvalFunction } from "@/types/evals";

export const expect_act_timeout_global: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    actTimeoutMs: 1_000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://docs.stagehand.dev");

  const result = await stagehand.page.act({
    action: "search for 'Stagehand'",
    slowDomBasedAct: true,
  });
  console.log("RESULT", result);

  await stagehand.close();

  return {
    _success: !result.success,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
