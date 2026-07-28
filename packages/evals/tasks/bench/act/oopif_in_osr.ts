import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "oopif_in_osr" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    // this eval is designed to test whether stagehand can successfully
    // fill a form inside a OOPIF (out of process iframe) that is inside an
    // OSR (open mode shadow) root

    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-open-shadow-dom/",
      );
      await stagehand.act("fill 'nunya' into the first name field");

      const firstNameValue = await page.locator('iframe >> input[placeholder="Jane"]').inputValue();

      if (firstNameValue.trim().toLowerCase() === "nunya") {
        return {
          _success: true,
          message: `successfully filled the form`,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message: `unable to fill the form`,
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
    } finally {
      await stagehand.close();
    }
  },
);
