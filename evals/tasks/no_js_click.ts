import { EvalFunction } from "@/types/evals";
import { ObserveResult } from "@/types/stagehand";

export const no_js_click: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  /**
   * This eval is meant to test whether our `clickElement` function
   * (inside actHandlerUtils.ts) is able to click elements even if
   * the site blocks programmatic JS click events.
   */

  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/no-js-click/",
    );

    const observeResult: ObserveResult = {
      method: "click",
      selector: "xpath=/html/body/button",
      description: "the button to click",
      arguments: [],
    };
    await stagehand.page.act(observeResult);

    const text = await stagehand.page.textContent("#success-msg");
    if (text?.trim() === "click succeeded") {
      return {
        _success: true,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: false,
      message: "unable to click element on website that blocks JS click events",
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      message: `error attempting to click the button: ${error.message}`,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
