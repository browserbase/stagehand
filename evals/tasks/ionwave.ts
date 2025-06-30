import { EvalFunction } from "@/types/evals";

export const ionwave: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/",
  );

  await stagehand.page.act({
    action: 'Click on "Closed Bids"',
  });

  const expectedUrl =
    "https://browserbase.github.io/stagehand-eval-sites/sites/ionwave/closed-bids.html";
  const currentUrl = stagehand.page.url();

  await stagehand.close();

  return {
    _success: currentUrl.startsWith(expectedUrl),
    currentUrl,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
