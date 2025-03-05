import { z } from "zod";
import { initStagehand } from "@/evals/initStagehand";
import { EvalFunction } from "@/types/evals";

export const extract_aigrant_targeted_2: EvalFunction = async ({
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
    instruction: "Extract the name of the company that comes after 'Coframe'.",
    schema: z.object({
      company_name: z.string(),
    }),
    modelName,
    useTextExtract,
    selector: selector,
  });

  await stagehand.close();
  const companyName = company.company_name;

  // nameWeShouldNotGet matches the name of the company that comes after
  // CoFrame on the website. Since we are using targeted_extract here,
  // and passing in a selector that does NOT contain the nameWeShouldNotGet,
  // the LLM should have no visibility into what comes after 'CoFrame' if
  // targeted_extract is performing correctly
  const nameWeShouldNotGet = {
    company_name: "OpusClip",
  };

  const nameMatches = companyName == nameWeShouldNotGet.company_name;

  if (nameMatches) {
    logger.error({
      message:
        "extracted company name matches the company name that we SHOULD NOT get",
      level: 0,
      auxiliary: {
        expected: {
          value: nameWeShouldNotGet.company_name,
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
      error:
        "extracted company name matches the company name that we SHOULD NOT get",
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
