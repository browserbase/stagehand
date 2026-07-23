import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

export default defineBenchV4Task(
  { name: "extract_aigrant_targeted" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/aigrant/",
      );
      // NOTE: v3 passes a bare XPath here; v4 documents options.selector as
      // CSS-only (V4_API_LOGS.md #10). Ported verbatim on purpose.
      const selector = "/html/body/div/ul[5]/li[28]";
      const company = await stagehand.extract(
        "Extract the company name.",
        z.object({
          company_name: z.string(),
        }),
        { selector: selector },
      );

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
  },
);
