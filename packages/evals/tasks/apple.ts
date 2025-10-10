import { EvalFunction } from "../types/evals";

export const apple: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  v3,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.apple.com/iphone-16-pro/");

    await v3.act("click on the buy button");
    await v3.act("select the Pro Max model");
    await v3.act("select the natural titanium color");
    await v3.act("select the 256GB storage option");
    await v3.act("click on the 'select a smartphone' trade-in option");

    await v3.act("select the iPhone 13 mini model from the dropdown");
    await v3.act("select the iPhone 13 mini is in good condition");

    const successMessageLocator = page.locator(
      'text="Good News. Your iPhone 13 mini qualifies for credit."',
    );
    const isVisible = await successMessageLocator.isVisible();

    return {
      _success: isVisible,
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
