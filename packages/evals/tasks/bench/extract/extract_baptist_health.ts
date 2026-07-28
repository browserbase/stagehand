import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { compareStrings } from "../../../scoring.js";

export default defineBenchTask(
  { name: "extract_baptist_health" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/baptist-health/");

      const { data: result } = await stagehand.extract(
        "Extract the address, phone number, and fax number of the healthcare location.",
        z.object({
          address: z.string(),
          phone: z.string(),
          fax: z.string(),
        }),
      );

      const { address, phone, fax } = result;
      const expected = {
        address: "2055 East South Blvd; Suite 908 Montgomery, AL 36116",
        phone: "334-747-2273",
        fax: "334-747-7501",
      };

      const similarityThreshold = 0.85;
      const failedFields: Array<{
        field: string;
        similarity: number;
        expected: string;
        actual: string;
      }> = [];

      const compareField = (actualVal: string, expectedVal: string, fieldName: string) => {
        if (fieldName === "Phone number" || fieldName === "Fax number") {
          const matches = actualVal.replace(/\D/g, "") === expectedVal.replace(/\D/g, "");
          if (!matches) {
            failedFields.push({
              field: fieldName,
              similarity: 0,
              expected: expectedVal,
              actual: actualVal,
            });
            logger.error({
              message: `${fieldName} extracted does not match`,
              level: 0,
              auxiliary: {
                field: { value: fieldName, type: "string" },
                expected: { value: expectedVal, type: "string" },
                actual: { value: actualVal, type: "string" },
              },
            });
          }
          return matches;
        }
        const { similarity, meetsThreshold } = compareStrings(
          actualVal,
          expectedVal,
          similarityThreshold,
        );

        if (!meetsThreshold) {
          failedFields.push({
            field: fieldName,
            similarity,
            expected: expectedVal,
            actual: actualVal,
          });
          logger.error({
            message: `${fieldName} extracted does not meet similarity threshold`,
            level: 0,
            auxiliary: {
              field: { value: fieldName, type: "string" },
              similarity: { value: similarity.toFixed(2), type: "string" },
              expected: { value: expectedVal, type: "string" },
              actual: { value: actualVal, type: "string" },
            },
          });
        }

        return meetsThreshold;
      };

      const addressOk = compareField(address, expected.address, "Address");
      const phoneOk = compareField(phone, expected.phone, "Phone number");
      const faxOk = compareField(fax, expected.fax, "Fax number");

      if (!addressOk || !phoneOk || !faxOk) {
        return {
          _success: false,
          error: "Some fields did not match expected values",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
          failedFields,
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
        error: String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }
  },
);
