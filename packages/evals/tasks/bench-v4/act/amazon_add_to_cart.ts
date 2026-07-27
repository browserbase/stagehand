import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "amazon_add_to_cart" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/amazon/",
      );

      await stagehand.act("click the 'Add to Cart' button");

      await stagehand.act("click the 'Proceed to checkout' button");

      const currentUrl = await page.url();
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
      await stagehand.close();
    }
  },
);
