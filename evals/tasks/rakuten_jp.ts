import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../utils";

export const rakuten_jp: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.rakuten.co.jp/");
  await stagehand.act({ action: "click on online supermarket" });

  await stagehand.act({ action: "if there is a popup, close it" });

  await stagehand.act({ action: "navigate to Inageya Online Supermarket" });
  await stagehand.act({ action: "click the search bar input" });
  await stagehand.act({ action: "search for '香菜'" });

  const url = stagehand.page.url();
  const successUrl =
    "https://netsuper.rakuten.co.jp/inageya/search/?keyword=%E9%A6%99%E8%8F%9C";

  await stagehand.close();

  return {
    _success: url === successUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
