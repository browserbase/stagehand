import { z } from "zod/v3";
import { EvalFunction } from "@/types/evals";

export const extract_aigrant_targeted: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
    );
    const selector = "/html/body/div/ul[5]/li[28]";
    const company = await stagehand.page.extract({
      instruction: "Extract the company name.",
      schema: z.object({
        company_name: z.string(),
      }),
      selector: selector,
    });

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
  } catch (error) {
    return {
      _success: false,
      error: error,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.close();
  }
};
