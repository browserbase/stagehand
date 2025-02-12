import { EvalFunction } from "@/types/evals";

import { performPlaywrightMethod } from "@/lib/a11y/utils";

export const observe_amazon_add_to_cart: EvalFunction = async ({
  stagehand,
  logger,
}) => {
  await stagehand.page.goto(
    "https://www.amazon.com/Laptop-MacBook-Surface-Water-Resistant-Accessories/dp/B0D5M4H5CD",
  );

  await stagehand.page.waitForTimeout(5000);

  const observations1 = await stagehand.page.observe({
    instruction: "Find and click the 'Add to Cart' button",
    onlyVisible: false,
    returnAction: true,
  });

  console.log(observations1);

  // Example of using performPlaywrightMethod if you have the xpath
  if (observations1.length > 0) {
    const action1 = observations1[0];
    await performPlaywrightMethod(
      stagehand.page,
      stagehand.logger,
      action1.method,
      action1.arguments,
      action1.selector.replace("xpath=", ""),
    );
  }

  await stagehand.page.waitForTimeout(2000);

  const observations2 = await stagehand.page.observe({
    instruction: "Find and click the 'Proceed to checkout' button",
    onlyVisible: false,
    returnAction: true,
  });

  // Example of using performPlaywrightMethod if you have the xpath
  if (observations2.length > 0) {
    const action2 = observations2[0];
    await performPlaywrightMethod(
      stagehand.page,
      stagehand.logger,
      action2.method,
      action2.arguments,
      action2.selector.replace("xpath=", ""),
    );
  }
  await stagehand.page.waitForTimeout(2000);

  const currentUrl = stagehand.page.url();
  const expectedUrlPrefix = "https://www.amazon.com/ap/signin";

  await stagehand.close();

  return {
    _success: currentUrl.startsWith(expectedUrlPrefix),
    currentUrl,

    logs: logger.getLogs(),
  };
};
