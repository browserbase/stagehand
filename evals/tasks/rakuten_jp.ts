import { EvalFunction } from "@/types/evals";

export const rakuten_jp: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto("https://www.rakuten.co.jp/");
  await stagehand.page.act({ action: "click on online supermarket" });

  await stagehand.page.act({ action: "if there is a popup, close it" });

  await stagehand.page.act({
    action: "navigate to Inageya Online Supermarket",
  });
  await stagehand.page.act({ action: "click the search bar input" });
  await stagehand.page.act({ action: "search for '香菜'" });

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
