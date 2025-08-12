import { EvalFunction } from "@/types/evals";

export const oopif_in_osr: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  // this eval is designed to test whether stagehand can successfully
  // fill a form inside a OOPIF (out of process iframe) that is inside an
  // OSR (open mode shadow) root

  const page = stagehand.page;
  try {
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-open-shadow-dom/",
    );
    await page.act({
      action: "fill 'nunya' into the first name field",
      iframes: true,
    });

    const extraction = await page.extract({
      instruction: "extract the entire page text",
      iframes: true,
    });

    const pageText = extraction.extraction;

    if (pageText.includes("nunya")) {
      return {
        _success: true,
        message: `successfully filled the form`,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
    return {
      _success: false,
      message: `unable to fill the form`,
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
