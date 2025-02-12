import { EvalFunction } from "@/types/evals";

export const vanta_h: EvalFunction = async ({ stagehand, logger }) => {
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
    logs: logger.getLogs(),
  };
};
