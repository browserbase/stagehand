import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

export default defineBenchTask(
  { name: "extract_aigrant_targeted_2" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/");
      // The locator engine prefix is required for XPath selectors.
      const locator = page.locator("xpath=/html/body/div/ul[5]/li[28]");
      const { data: company } = await stagehand.extract(
        "Extract the name of the company that comes after 'Coframe'.",
        z.object({
          company_name: z.string(),
        }),
        { locator },
      );
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
          message: "extracted company name matches the company name that we SHOULD NOT get",
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
          error: "extracted company name matches the company name that we SHOULD NOT get",
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
        error: error instanceof Error ? error.message : String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
  },
);
