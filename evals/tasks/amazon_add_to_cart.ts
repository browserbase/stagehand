import { EvalFunction } from "@/types/evals";

export const amazon_add_to_cart: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/",
    );

    await stagehand.page.waitForTimeout(5000);

    await stagehand.page.act({
      action: "click the 'Add to Cart' button",
    });

    await stagehand.page.waitForTimeout(2000);

    await stagehand.page.act({
      action: "click the 'Proceed to checkout' button",
    });

    await stagehand.page.waitForTimeout(2000);
    const currentUrl = stagehand.page.url();
    const expectedUrl =
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/sign-in.html";

    return {
      _success: currentUrl === expectedUrl,
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
