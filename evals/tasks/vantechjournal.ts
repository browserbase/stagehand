import { EvalFunction } from "@/types/evals";

export const vantechjournal: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto("https://vantechjournal.com/");

  await stagehand.page.act({
    action: "click on page 8. do not click the next button",
  });

  const expectedUrl = "https://vantechjournal.com/archive?page=8";
  const currentUrl = stagehand.page.url();

  await stagehand.close();

  return {
    _success: currentUrl === expectedUrl,
    currentUrl,
    expectedUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
