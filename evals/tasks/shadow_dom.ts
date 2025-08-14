import { EvalFunction } from "@/types/evals";

export const shadow_dom: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  const page = stagehand.page;
  try {
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/shadow-dom/",
    );
    await page.act("click the button");
    const extraction = await page.extract({
      instruction: "extract the page text",
    });

    const pageText = extraction.extraction;

    if (pageText.includes("button successfully clicked")) {
      return {
        _success: true,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: false,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      message: `error: ${error.message}`,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
