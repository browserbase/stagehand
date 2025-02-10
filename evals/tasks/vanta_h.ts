import { EvalFunction } from "@/types/evals";
import { initStagehand } from "@/evals/initStagehand";

export const vanta_h: EvalFunction = async ({
  modelName,
  logger,
  configOverrides,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    configOverrides: {
      ...configOverrides,
    },
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://www.vanta.com/");

  const observations = await stagehand.page.observe({
    instruction: "find the buy now button if it is available",
    onlyVisible: true,
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
