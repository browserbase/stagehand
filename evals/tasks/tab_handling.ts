import { EvalFunction } from "@/types/evals";

export const tab_handling: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/",
    );

    await stagehand.page.act({
      action: "click the button to open the other page",
    });

    const pages = stagehand.context.pages();
    const page1 = pages[0];
    const page2 = pages[1];

    // extract all the text from the first page
    const extraction1 = await page1.extract();
    // extract all the text from the second page
    const extraction2 = await page2.extract();

    const extraction1Success = extraction1.page_text.includes("Welcome!");
    const extraction2Success = extraction2.page_text.includes(
      "You’re on the other page",
    );

    return {
      _success: extraction1Success && extraction2Success,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      message: error.message,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
