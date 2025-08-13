import { EvalFunction } from "@/types/evals";

export const namespace_xpath: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/namespaced-xpath/",
    );

    await stagehand.page.act({
      action: "fill 'nunya' into the 'type here' form",
    });

    const inputValue = await stagehand.page.locator("#ns-text").inputValue();
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
    await stagehand.close();
  }
};
