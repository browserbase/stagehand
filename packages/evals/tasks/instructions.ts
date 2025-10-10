import { EvalFunction } from "../types/evals";

export const instructions: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];

    await page.goto("https://docs.browserbase.com/");

    await v3.act("secret12345");

    await page.waitForLoadState("domcontentloaded");

    const url = page.url();

    const isCorrectUrl =
      (await url) ===
      "https://docs.browserbase.com/introduction/what-is-browserbase";

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
    await v3.close();
  }
};
