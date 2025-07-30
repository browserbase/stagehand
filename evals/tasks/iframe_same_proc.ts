import { EvalFunction } from "@/types/evals";

export const iframe_same_proc: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    const page = stagehand.page;
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-same-proc/",
    );

    await page.act({
      action: "type 'stagehand' into the 'your name' field",
      iframes: true,
    });

    // overly specific prompting is okay here. we are just trying to evaluate whether
    // we are properly traversing iframes
    await page.act({
      action:
        "select 'Green' from the favorite colour dropdown. Ensure the word 'Green' is capitalized. Choose the selectOption playwright method.",
      iframes: true,
    });

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
    await stagehand.close();
  }
};
