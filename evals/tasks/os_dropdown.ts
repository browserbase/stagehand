import { EvalFunction } from "@/types/evals";

export const os_dropdown: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  /**
   * This eval is meant to test whether we can correctly select an element
   * from an OS level dropdown
   */

  try {
    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/nested-dropdown/",
    );

    await page.act(
      "choose 'Smog Check Technician' from the 'License Type' dropdown",
    );
    const selectedOption = await page
      .locator(
        "xpath=/html/body/form/div[1]/div[3]/article/div[2]/div[1]/select[2] >> option:checked",
      )
      .textContent();

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
      message: `error attempting to select an option from the dropdown: ${error.message}`,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
