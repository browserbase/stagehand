import { EvalFunction } from "@/types/evals";

export const instructions: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    const page = stagehand.page;

    await page.goto("https://docs.browserbase.com/");

    await page.act({
      action: "secret12345",
    });

    await page.waitForLoadState("domcontentloaded");

    const url = page.url();

    const isCorrectUrl =
      url === "https://docs.browserbase.com/introduction/what-is-browserbase";

    return {
      _success: isCorrectUrl,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
