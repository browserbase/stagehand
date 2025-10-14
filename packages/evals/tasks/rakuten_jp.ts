import { EvalFunction } from "../types/evals";

export const rakuten_jp: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.rakuten.co.jp/");

    await v3.act("type '香菜' into the search bar");
    await v3.act("press enter");
    const url = page.url();
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
    await v3.close();
  }
};
