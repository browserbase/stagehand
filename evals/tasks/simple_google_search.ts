import { initStagehand } from "../utils";
import { EvalFunction } from "../../types/evals";

export const simple_google_search: EvalFunction = async ({
  modelName,
  logger,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.google.com");

  await stagehand.act({
    action: 'Search for "OpenAI"',
  });

  const expectedUrl = "https://www.google.com/search?q=OpenAI";
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
