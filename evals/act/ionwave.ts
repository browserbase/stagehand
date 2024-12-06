import { initStagehand } from "../utils";
import { EvalFunction } from "../../types/evals";

export const ionwave: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://elpasotexas.ionwave.net/Login.aspx");

  await stagehand.act({
    action: 'Click on "Closed Bids"',
  });

  const expectedUrl =
    "https://elpasotexas.ionwave.net/SourcingEvents.aspx?SourceType=2";
  const currentUrl = stagehand.page.url();

  await stagehand.close();

  return {
    _success: currentUrl.startsWith(expectedUrl),
    currentUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
