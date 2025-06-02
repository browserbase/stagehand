import { EvalFunction } from "@/types/evals";

export const simple_google_search: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  await stagehand.page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/google/",
  );

  await stagehand.page.act({
    action: 'type "OpenAI" into the search bar',
  });

  await stagehand.page.act("click the search button");

  const expectedUrl =
    "https://browserbase.github.io/stagehand-eval-sites/sites/google/openai.html";
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
