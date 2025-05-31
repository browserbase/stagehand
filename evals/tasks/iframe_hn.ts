import { EvalFunction } from "@/types/evals";

export const iframe_hn: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  const page = stagehand.page;
  await page.goto(
    "https://browserbase.github.io/stagehand-eval-sites/sites/iframe-hn/",
  );

  const result = await page.extract(
    "extract the title of the first hackernews story",
  );

  await stagehand.close();

  const title = result.extraction.toLowerCase();
  const expectedTitleSubstring = "overengineered anchor links";

  if (!title.includes(expectedTitleSubstring)) {
    logger.error({
      message: `Extracted title: ${title} does not contain expected substring: ${expectedTitleSubstring}`,
      level: 0,
    });
    return {
      _success: false,
      error: `Extracted title: ${title} does not contain expected substring: ${expectedTitleSubstring}`,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  if (!title.includes(expectedTitleSubstring)) {
    logger.error({
      message: `Extracted title: ${title} does not contain expected substring: ${expectedTitleSubstring}`,
      level: 0,
    });
    return {
      _success: false,
      error: `Extracted title: ${title} does not contain expected substring: ${expectedTitleSubstring}`,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  }

  return {
    _success: true,
    logs: logger.getLogs(),
    debugUrl,
    sessionUrl,
  };
};
