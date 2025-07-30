import { EvalFunction } from "@/types/evals";

export const vanta_h: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto("https://www.vanta.com/");

    const observations = await stagehand.page.observe(
      "click the buy now button if it is available",
    );

    // we should have no saved observation since the element shouldn't exist
    return {
      _success: observations.length === 0,
      observations,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    return {
      _success: false,
      error: error,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } finally {
    await stagehand.close();
  }
};
