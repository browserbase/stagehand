import { EvalFunction } from "../types/evals";

export const vanta_h: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.vanta.com/");

    const observations = await v3.observe(
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
    await v3.close();
  }
};
