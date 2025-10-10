import { EvalFunction } from "../types/evals";

export const checkboxes: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/checkboxes/",
    );

    await v3.act("click the 'baseball' option");

    await v3.act("click the 'netball' option");

    const baseballChecked = await page
      .locator('input[type="checkbox"][name="sports"][value="baseball"]')
      .isChecked();

    const netballChecked = await page
      .locator('input[type="checkbox"][name="sports"][value="netball"]')
      .isChecked();

    return {
      _success: baseballChecked && netballChecked,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (e) {
    return {
      _success: false,
      error: e,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await v3.close();
  }
};
