import { EvalFunction } from "@/types/evals";

export const amazon_add_to_cart: EvalFunction = async ({
  logger,
  stagehand,
}) => {
  await stagehand.page.goto(
    "https://www.amazon.com/Laptop-MacBook-Surface-Water-Resistant-Accessories/dp/B0D5M4H5CD",
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
  const expectedUrlPrefix = "https://www.amazon.com/ap/signin";

  await stagehand.close();

  return {
    _success: currentUrl.startsWith(expectedUrlPrefix),
    currentUrl,
    logs: logger.getLogs(),
  };
};
