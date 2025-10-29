import { EvalFunction } from "../types/evals";
import { Action } from "@browserbasehq/stagehand";

export const no_js_click: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  /**
   * This eval is meant to test whether our `clickElement` function
   * (inside actHandlerUtils.ts) is able to click elements even if
   * the site blocks programmatic JS click events.
   */

  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/no-js-click/",
    );

    const observeResult: Action = {
      method: "click",
      selector: "xpath=/html/body/button",
      description: "the button to click",
      arguments: [],
    };
    await v3.act(observeResult);

    const text = await page.locator("#success-msg").textContent();
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
    await v3.close();
  }
};
