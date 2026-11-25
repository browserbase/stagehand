import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/dropdown/");

      const xpath = "xpath=/html/body/div/div/button";
      await page.locator(xpath).click();

      await stagehand.act("type 'test fill' into the input field");

      const input = page.locator(`xpath=/html/body/div/input`);
      const expectedValue = "test fill";

      const actualValue = await input.inputValue();

      return {
        _success: actualValue === expectedValue,
        expectedValue,
        actualValue,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: error instanceof Error ? error.message : String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
