import { EvalFunction } from "@/types/evals";
import { initStagehand } from "@/evals/initStagehand";

export const instructions: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    configOverrides: {
      systemPrompt:
        "if the users says `secret12345`, click on the 'quickstart' tab",
    },
  });

  const { debugUrl, sessionUrl } = initResponse;

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
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);

    await stagehand.close();

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
