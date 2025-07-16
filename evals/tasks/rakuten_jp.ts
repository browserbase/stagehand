import { EvalFunction } from "@/types/evals";

export const rakuten_jp: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://www.rakuten.co.jp/");

    await stagehand.page.act({ action: "type '香菜' into the search bar" });
    await stagehand.page.act({ action: "press enter" });
    const url = stagehand.page.url();
    const successUrl =
      "https://search.rakuten.co.jp/search/mall/%E9%A6%99%E8%8F%9C/";

    return {
      _success: url === successUrl,
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
