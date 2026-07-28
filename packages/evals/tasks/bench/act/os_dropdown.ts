import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "os_dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    /**
     * This eval is meant to test whether we can correctly select an element
     * from an OS level dropdown
     */

    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/nested-dropdown/");

      await stagehand.act("choose 'Smog Check Technician' from the 'License Type' dropdown");
      const selectedOption = await page.evaluate(() => {
        const option = document.querySelector(
          "#licenseType option:checked",
        ) as HTMLOptionElement | null;
        return option?.textContent ?? null;
      });

      if (selectedOption === "Smog Check Technician") {
        return {
          _success: true,
          debugUrl,
          sessionUrl,
          logs: logger.getLogs(),
        };
      }
      return {
        _success: false,
        message: "incorrect option selected from the dropdown",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
