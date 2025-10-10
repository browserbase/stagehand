import { EvalFunction } from "../types/evals";

export const dropdown: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/dropdown/",
    );

    // click the dropdown element to expand it
    const xpath = "xpath=/html/body/div/div/button";
    await page.locator(xpath).click();

    // type into the input box (which should be hidden behind the
    // expanded dropdown)
    await v3.act("type 'test fill' into the input field");

    const input = page.locator(`xpath=/html/body/div/input`);
    const expectedValue = "test fill";

    // get the value of the input box
    const actualValue = await input.inputValue();

    // pass if the value matches expected
    return {
      _success: actualValue === expectedValue,
      expectedValue,
      actualValue,
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
