import { EvalFunction } from "../types/evals";

export const amazon_add_to_cart: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/",
    );

    await v3.act("click the 'Add to Cart' button");

    await v3.act("click the 'Proceed to checkout' button");

    const currentUrl = page.url();
    const expectedUrl =
      "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/sign-in.html";

    console.log("currentUrl", currentUrl);
    console.log("expectedUrl", expectedUrl);
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
    await v3.close();
  }
};
