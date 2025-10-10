import { EvalFunction } from "../types/evals";

export const osr_in_spif: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  // this eval is designed to test whether stagehand can successfully
  // click inside an OSR (open mode shadow) root that is inside an
  // SPIF (same process iframe)

  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/open-shadow-root-in-spif/",
    );
    await v3.act("click the button");

    const extraction = await v3.extract("extract the entire page text");

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
    await v3.close();
  }
};
