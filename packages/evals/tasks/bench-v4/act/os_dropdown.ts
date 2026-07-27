import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "os_dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    /**
     * This eval is meant to test whether we can correctly select an element
     * from an OS level dropdown
     */

    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/nested-dropdown/",
      );

      await stagehand.act(
        "choose 'Smog Check Technician' from the 'License Type' dropdown",
      );
      // v3 used page.locator("#licenseType >> option:checked"); v4 locator has
      // no ">>" chaining, so the same check is re-expressed in-page.
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
        message: `error attempting to select an option from the dropdown: ${(error as Error).message}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
