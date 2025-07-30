import { EvalFunction } from "@/types/evals";

export const checkboxes: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/checkboxes/",
    );

    await stagehand.page.act({
      action: "click the 'baseball' option",
    });

    await stagehand.page.act({
      action: "click the 'netball' option",
    });

    const baseballChecked = await stagehand.page
      .locator('input[type="checkbox"][name="sports"][value="baseball"]')
      .isChecked();

    const netballChecked = await stagehand.page
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
    await stagehand.close();
  }
};
