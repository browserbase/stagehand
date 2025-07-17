import { EvalFunction } from "@/types/evals";

export const observe_amazon_add_to_cart: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/",
    );

    await stagehand.page.waitForTimeout(5000);

    const observations1 = await stagehand.page.observe({
      instruction: "Find and click the 'Add to Cart' button",
    });

    // Example of using performPlaywrightMethod if you have the xpath
    if (observations1.length > 0) {
      const action1 = observations1[0];
      await stagehand.page.act(action1);
    }

    await stagehand.page.waitForTimeout(2000);

    const observations2 = await stagehand.page.observe({
      instruction: "Find and click the 'Proceed to checkout' button",
    });

    // Example of using performPlaywrightMethod if you have the xpath
    if (observations2.length > 0) {
      const action2 = observations2[0];
      await stagehand.page.act(action2);
    }
    await stagehand.page.waitForTimeout(2000);

    const currentUrl = stagehand.page.url();
    const expectedUrlPrefix =
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/sign-in.html";

    return {
      _success: currentUrl.startsWith(expectedUrlPrefix),
      currentUrl,
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
