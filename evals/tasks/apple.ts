import { EvalFunction } from "@/types/evals";

export const apple: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto("https://www.apple.com/iphone-16-pro/");

    await stagehand.page.act({ action: "click on the buy button" });
    await stagehand.page.act({ action: "select the Pro Max model" });
    await stagehand.page.act({ action: "select the natural titanium color" });
    await stagehand.page.act({ action: "select the 256GB storage option" });
    await stagehand.page.act({
      action: "click on the 'select a smartphone' trade-in option",
    });

    await stagehand.page.act({
      action: "select the iPhone 13 mini model from the dropdown",
    });
    await stagehand.page.act({
      action: "select the iPhone 13 mini is in good condition",
    });

    const successMessageLocator = stagehand.page.locator(
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
    await stagehand.close();
  }
};
