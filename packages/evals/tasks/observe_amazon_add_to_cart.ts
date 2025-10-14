import { EvalFunction } from "../types/evals";

export const observe_amazon_add_to_cart: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/",
    );

    const observations1 = await v3.observe(
      "Find and click the 'Add to Cart' button",
    );

    // Example of using performPlaywrightMethod if you have the xpath
    if (observations1.length > 0) {
      const action1 = observations1[0];
      await v3.act(action1);
    }

    const observations2 = await v3.observe(
      "Find and click the 'Proceed to checkout' button",
    );

    // Example of using performPlaywrightMethod if you have the xpath
    if (observations2.length > 0) {
      const action2 = observations2[0];
      await v3.act(action2);
    }

    const currentUrl = page.url();
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
    await v3.close();
  }
};
