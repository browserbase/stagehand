import { EvalFunction } from "../types/evals";

export const iframes_nested: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/nested-iframes/",
    );

    await v3.act("type 'stagehand' into the 'username' field");

    const inner = page
      .frameLocator("iframe.lvl1") // level 1
      .frameLocator("iframe.lvl2") // level 2
      .frameLocator("iframe.lvl3"); // level 3 – form lives here

    const usernameText = await inner
      .locator('input[name="username"]')
      .inputValue();

    const passed: boolean = usernameText.toLowerCase().trim() === "stagehand";

    return {
      _success: passed,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    return {
      _success: false,
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await v3.close();
  }
};
