import { EvalFunction } from "@/types/evals";
import { initStagehand } from "@/evals/initStagehand";

export const vantechjournal: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://vantechjournal.com/");

  await stagehand.page.act({
    action: "click on page 8. do not click the next button",
  });

  const expectedUrl = "https://vantechjournal.com/archive?page=8";
  const currentUrl = stagehand.page.url();

  await stagehand.close();

  return {
    _success: currentUrl === expectedUrl,
    currentUrl,
    expectedUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
