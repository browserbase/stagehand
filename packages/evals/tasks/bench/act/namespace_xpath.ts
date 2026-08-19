import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "namespace_xpath" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/namespaced-xpath/");

      await stagehand.act("fill 'nunya' into the 'type here' form");

      const inputValue = await page.locator("#ns-text").inputValue();
      // confirm that the form was filled
      const formHasBeenFilled = inputValue === "nunya";

      return {
        _success: formHasBeenFilled,
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
