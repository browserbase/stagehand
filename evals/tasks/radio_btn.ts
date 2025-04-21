import { EvalFunction } from "@/types/evals";

export const radio_btn: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/paneer-pizza/",
  );

  await stagehand.page.act({
    action: "click the 'medium' option",
  });

  // confirm that the Medium radio is now checked
  const radioBtnClicked = await stagehand.page
    .locator('input[type="radio"][name="Pizza"][value="Medium"]')
    .isChecked();

  await stagehand.close();

  return {
    _success: radioBtnClicked,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
