import { EvalFunction } from "@/types/evals";

export const multi_tab: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    const stagehandPage = stagehand.page;
    await stagehandPage.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/",
    );

    await stagehandPage.act({
      action: "click the button to open the other page",
    });
    await stagehandPage.act({
      action: "click the button to open the other page",
    });
    await stagehandPage.act({
      action: "click the button to open the other page",
    });
    await stagehandPage.act({
      action: "click the button to open the other page",
    });

    let currentPageUrl = stagehandPage.url();
    let expectedUrl =
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page5.html";

    if (currentPageUrl !== expectedUrl) {
      return {
        _success: false,
        message: "expected URL does not match current URL",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    // try acting on the first page again
    const pages = stagehand.context.pages();
    const page1 = pages[0];
    await page1.act({
      action: "click the button to open the other page",
    });

    // stagehandPage.url() should point to the URL of the active page
    currentPageUrl = stagehandPage.url();
    expectedUrl =
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/page2.html";
    if (currentPageUrl !== expectedUrl) {
      return {
        _success: false,
        message: "expected URL does not match current URL",
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }

    const page2text = await stagehandPage.extract();
    const expectedPage2text = "You've made it to page 2";

    if (page2text.page_text.includes(expectedPage2text)) {
      return {
        _success: true,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: false,
      message: `extracted page text: ${page2text.page_text} does not match expected page text: ${expectedPage2text}`,
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
