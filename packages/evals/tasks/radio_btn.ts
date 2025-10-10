import { EvalFunction } from "../types/evals";

export const radio_btn: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/paneer-pizza/",
    );

    await v3.act("click the 'medium' option");

    // confirm that the Medium radio is now checked
    const radioBtnClicked = await page
      .locator('input[type="radio"][name="Pizza"][value="Medium"]')
      .isChecked();

    return {
      _success: radioBtnClicked,
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
    await v3.close();
  }
};
