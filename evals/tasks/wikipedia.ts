import { EvalFunction } from "@/types/evals";

export const wikipedia: EvalFunction = async ({ stagehand, logger }) => {
  await stagehand.page.goto(`https://en.wikipedia.org/wiki/Baseball`);
  await stagehand.page.act('click the "hit and run" link in this article');

  const url = "https://en.wikipedia.org/wiki/Hit_and_run_(baseball)";
  const currentUrl = stagehand.page.url();

  await stagehand.close();

  return {
    _success: currentUrl === url,
    expected: url,
    actual: currentUrl,

    logs: logger.getLogs(),
  };
};
