import { EvalFunction } from "../types/evals";

export const iframe_same_proc: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-same-proc/",
    );

    await v3.act("type 'stagehand' into the 'your name' field");

    // overly specific prompting is okay here. we are just trying to evaluate whether
    // we are properly traversing iframes
    await v3.act(
      "select 'Green' from the favorite colour dropdown. Ensure the word 'Green' is capitalized. Choose the selectOption method.",
    );

    const iframe = page.frameLocator("iframe");

    const nameValue: string = await iframe
      .locator('input[placeholder="Alice"]')
      .inputValue();

    const colorValue: string = await iframe.locator("select").inputValue();

    const passed: boolean =
      nameValue.toLowerCase().trim() === "stagehand" &&
      colorValue.toLowerCase().trim() === "green";

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
