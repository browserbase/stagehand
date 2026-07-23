import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "login" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/login/",
      );

      await stagehand.act("type %nunya% into the username field", {
        variables: { nunya: "business" },
      });

      const xpath = "xpath=/html/body/main/form/div[1]/input";
      const actualValue = await page.locator(xpath).inputValue();

      const expectedValue = "business";

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
