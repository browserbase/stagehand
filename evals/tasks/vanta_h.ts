import { initStagehand } from "../utils";
import { EvalFunction } from "../../types/evals";

export const vanta_h: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.vanta.com/");

  const observations = await stagehand.observe({
    instruction: "find the buy now button if it is available",
  });

  await stagehand.close();

  // we should have no saved observation since the element shouldn't exist
  return {
    _success: observations.length === 0,
    observations,
    debugUrl,
    sessionUrl,
    logs: logger.getLogs(),
  };
};
