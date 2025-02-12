import { EvalFunction } from "@/types/evals";

export const instructions: EvalFunction = async ({ stagehand, logger }) => {
  try {
    const page = stagehand.page;

    await page.goto("https://docs.browserbase.com/");

    await page.act({
      action: "secret12345",
    });

    await page.waitForLoadState("domcontentloaded");

    const url = page.url();

    const isCorrectUrl =
      url === "https://docs.browserbase.com/quickstart/playwright";

    await stagehand.close();

    return {
      _success: isCorrectUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);

    await stagehand.close();

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      logs: logger.getLogs(),
    };
  }
};
