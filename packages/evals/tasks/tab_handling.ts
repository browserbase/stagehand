import { EvalFunction } from "../types/evals";

export const tab_handling: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/",
    );

    await v3.act("click the button to open the other page");

    const pages = v3.context.pages();
    const page1 = pages[0];
    const page2 = pages[1];

    // extract all the text from the first page
    const extraction1 = await v3.extract({ page: page1 });
    // extract all the text from the second page
    const extraction2 = await v3.extract({ page: page2 });

    const extraction1Success = extraction1.pageText.includes("Welcome!");
    const extraction2Success = extraction2.pageText.includes(
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
    await v3.close();
  }
};
