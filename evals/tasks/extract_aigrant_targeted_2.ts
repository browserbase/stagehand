import { z } from "zod/v3";
import { EvalFunction } from "@/types/evals";

export const extract_aigrant_targeted_2: EvalFunction = async ({
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
      instruction:
        "Extract the name of the company that comes after 'Coframe'.",
      schema: z.object({
        company_name: z.string(),
      }),
      selector: selector,
    });
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
