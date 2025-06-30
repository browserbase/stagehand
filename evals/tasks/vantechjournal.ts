import { EvalFunction } from "@/types/evals";

export const vantechjournal: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto("https://vantechjournal.com");

  await stagehand.page.act({
    action: "click on page 'recommendations'",
  });

  const expectedUrl = "https://vantechjournal.com/recommendations";
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
