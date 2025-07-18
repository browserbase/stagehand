import { EvalFunction } from "@/types/evals";
import { FrameLocator } from "playwright";

export const nested_iframes_2: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  const page = stagehand.page;
  try {
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/nested-iframes-2/",
    );

    await page.act({
      action: "click the button called 'click me (inner 2)'",
      iframes: true,
    });

    const inner: FrameLocator = page
      .frameLocator('iframe[src="iframe2.html"]')
      .frameLocator('iframe[src="inner2.html"]');

    const messageText = await inner.locator("#msg").textContent();

    const passed: boolean =
      messageText.toLowerCase().trim() ===
      "clicked the button in the second inner iframe";

    return {
      _success: passed,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    return {
      _success: false,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
      error,
    };
  } finally {
    await stagehand.close();
  }
};
