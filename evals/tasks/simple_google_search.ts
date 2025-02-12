import { EvalFunction } from "@/types/evals";

export const simple_google_search: EvalFunction = async ({
  stagehand,
  logger,
}) => {
  await stagehand.page.goto("https://www.google.com");

  await stagehand.page.act({
    action: 'Search for "OpenAI"',
  });

  const expectedUrl = "https://www.google.com/search?q=OpenAI";
  const currentUrl = stagehand.page.url();

  await stagehand.close();

  return {
    _success: currentUrl.startsWith(expectedUrl),
    currentUrl,
    logs: logger.getLogs(),
  };
};
