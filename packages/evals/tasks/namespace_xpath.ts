import { EvalFunction } from "../types/evals";

export const namespace_xpath: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/namespaced-xpath/",
    );

    await v3.act("fill 'nunya' into the 'type here' form");

    const inputValue = await page.locator("#ns-text").inputValue();
    // confirm that the form was filled
    const formHasBeenFilled = inputValue === "nunya";

    return {
      _success: formHasBeenFilled,
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
