import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "os_dropdown" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://stagehand-eval-sites.vercel.app/sites/nested-dropdown/");

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
        message: `error attempting to select an option from the dropdown: ${(error as Error).message}`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
