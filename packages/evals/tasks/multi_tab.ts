import { EvalFunction } from "../types/evals";

export const multi_tab: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/five-tab/",
    );

    await v3.act("click the button to open the other page");
    await v3.act("click the button to open the other page");
    await v3.act("click the button to open the other page");
    await v3.act("click the button to open the other page");
    let activePage = await v3.context.awaitActivePage();

    let currentPageUrl = await activePage.url();
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
    const pages = v3.context.pages();
    const page1 = pages[0];
    await v3.act("click the button to open the other page", { page: page1 });

    activePage = await v3.context.awaitActivePage();
    currentPageUrl = await activePage.url();
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

    const page2text = await v3.extract({ page: activePage });
    const expectedPage2text = "You've made it to page 2";

    if (page2text.pageText.includes(expectedPage2text)) {
      return {
        _success: true,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: false,
      message: `extracted page text: ${page2text.pageText} does not match expected page text: ${expectedPage2text}`,
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
