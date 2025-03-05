import { z } from "zod";
import { initStagehand } from "@/evals/initStagehand";
import { EvalFunction } from "@/types/evals";

export const extract_aigrant_targeted: EvalFunction = async ({
  modelName,
  logger,
  useTextExtract,
}) => {
  const { stagehand, initResponse } = await initStagehand({
    modelName,
    logger,
    domSettleTimeoutMs: 3000,
  });

  const { debugUrl, sessionUrl } = initResponse;

  await stagehand.page.goto("https://aigrant.com/");
  const selector = "/html/body/div/ul[5]/li[28]";
  const company = await stagehand.page.extract({
    instruction: "Extract the company name.",
    schema: z.object({
      company_name: z.string(),
    }),
    modelName,
    useTextExtract,
    selector: selector,
  });

  await stagehand.close();
  const companyName = company.company_name;

  const expectedName = {
    company_name: "Coframe",
  };

  const nameMatches = companyName == expectedName.company_name;

  if (!nameMatches) {
    logger.error({
      message: "extracted company name does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: expectedName.company_name,
          type: "string",
        },
        actual: {
          value: companyName,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "Company name does not match expected",
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
