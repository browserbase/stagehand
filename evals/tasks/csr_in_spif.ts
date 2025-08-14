import { EvalFunction } from "@/types/evals";

export const csr_in_spif: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  // this eval is designed to test whether stagehand can successfully
  // click inside an CSR (closed mode shadow) root that is inside an
  // SPIF (same process iframe)

  const page = stagehand.page;
  try {
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/closed-shadow-dom-in-spif/",
    );
    await page.act({ action: "click the button", iframes: true });

    const extraction = await page.extract({
      instruction: "extract the entire page text",
      iframes: true,
    });

    const pageText = extraction.extraction;

    if (pageText.includes("button successfully clicked")) {
      return {
        _success: true,
        message: `successfully clicked the button`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: false,
      message: `unable to click on the button`,
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
