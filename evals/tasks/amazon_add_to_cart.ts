import { EvalFunction } from "@/lib/v3/types/evals";

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

    await v3.act({
      instruction: "click the 'Add to Cart' button",
    });

    await v3.act({
      instruction: "click the 'Proceed to checkout' button",
    });

    const currentUrl = await page.url();
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
    await v3.close();
  }
};
