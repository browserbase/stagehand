import { initStagehand } from "../utils";
import { EvalFunction } from "../../types/evals";

export const bidnet: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.bidnetdirect.com/");

  await stagehand.act({
    action: 'Click on the "Construction" keyword',
  });

  const expectedUrl =
    "https://www.bidnetdirect.com/public/solicitations/open?keywords=Construction";
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
