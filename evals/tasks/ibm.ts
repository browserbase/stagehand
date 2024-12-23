import { EvalFunction } from "../../types/evals";
import { initStagehand } from "../initStagehand";
import { z } from "zod";

export const ibm: EvalFunction = async ({ modelName, logger }) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
  });

  const { debugUrl, sessionUrl } = initResponse;

  try {
    await stagehand.page.goto("https://www.ibm.com/artificial-intelligence");

    await stagehand.page.act({
      action: "if there is a cookies popup, accept it",
    });

    const { title } = await stagehand.extract({
      instruction: "extract the title of the article",
      schema: z.object({
        title: z.string().describe("the title of the article"),
      }),
    });

    await stagehand.page.act({
      action: "click on the 'explore AI use cases' button",
    });

    await stagehand.page.waitForLoadState("networkidle");

    const url = await stagehand.page.url();

    await stagehand.close();

    const titleCheck = title.toLowerCase().includes("ai");
    const urlCheck = url === "https://www.ibm.com/watsonx/use-cases";

    return {
      _success: titleCheck && urlCheck,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);

    await stagehand.close();

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
