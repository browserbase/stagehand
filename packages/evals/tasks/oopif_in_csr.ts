import { EvalFunction } from "../types/evals";

export const oopif_in_csr: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  // this eval is designed to test whether stagehand can successfully
  // fill a form inside a OOPIF (out of process iframe) that is inside an
  // CSR (closed mode shadow) root

  try {
    const page = v3.context.pages()[0];
    await page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/oopif-in-open-shadow-dom/",
    );
    await v3.act("fill 'nunya' into the first name field");

    const extraction = await v3.extract("extract the entire page text");

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
    await v3.close();
  }
};
