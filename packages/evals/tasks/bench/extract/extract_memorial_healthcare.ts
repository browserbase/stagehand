import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { compareStrings } from "../../../framework/textScoring.js";

export default defineBenchTask(
  { name: "extract_memorial_healthcare" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/mycmh/");

      const { data: result } = await stagehand.extract(
        "extract a list of the first three healthcare centers on this page, with their name, full address, and phone number",
        z.object({
          health_centers: z.array(
            z.object({
              name: z.string(),
              phone_number: z.string(),
              address: z.string(),
            }),
          ),
        }),
      );

      const health_centers: Array<
        Partial<{ name: string; phone_number: string; address: string }>
      > = result.health_centers;

      const expectedLength = 3;
      const similarityThreshold = 0.85;

      const expectedHealthCenters = [
        {
          name: "Community Memorial Breast Center",
          phone_number: "805-948-5093",
          address: "168 North Brent Street, Suite 401, Ventura, CA 93003",
        },
        {
          name: "Community Memorial Continuing Care Center",
          phone_number: "805-948-2000",
          address: "1306 Maricopa Highway, Ojai, CA 93023",
        },
        {
          name: "Community Memorial Dermatology and Mohs Surgery",
          phone_number: "805-948-6920",
          address: "168 North Brent Street, Suite 403, Ventura, CA 93003",
        },
      ];

      if (health_centers.length !== expectedLength) {
        logger.error({
          message: "Incorrect number of health centers extracted",
          level: 0,
          auxiliary: {
            expected: {
              value: expectedLength.toString(),
              type: "integer",
            },
            actual: {
              value: health_centers.length.toString(),
              type: "integer",
            },
          },
        });

        return {
          _success: false,
          error: "Incorrect number of health centers extracted",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }

      const validateHealthCenter = (
        center: Partial<{
          name: string;
          phone_number: string;
          address: string;
        }>,
      ): { name: string; phone_number: string; address: string } | null => {
        if (center.name && center.phone_number && center.address) {
          return center as {
            name: string;
            phone_number: string;
            address: string;
          };
        }
        logger.error({
          message: "Invalid health center data",
          level: 0,
          auxiliary: {
            center: { value: JSON.stringify(center), type: "object" },
          },
        });
        return null;
      };

      const validHealthCenters = health_centers.map(validateHealthCenter).filter(Boolean) as Array<{
        name: string;
        phone_number: string;
        address: string;
      }>;

      if (validHealthCenters.length < expectedLength) {
        return {
          _success: false,
          error: "One or more health centers have missing fields",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }

      const compareField = (actual: string, expected: string, fieldName: string): boolean => {
        if (fieldName.endsWith("phone_number")) {
          const matches = actual.replace(/\D/g, "") === expected.replace(/\D/g, "");
          if (!matches) {
            logger.error({
              message: `Field "${fieldName}" does not match`,
              level: 0,
              auxiliary: {
                field: { value: fieldName, type: "string" },
                expected: { value: expected, type: "string" },
                actual: { value: actual, type: "string" },
              },
            });
          }
          return matches;
        }
        const { similarity, meetsThreshold } = compareStrings(
          actual,
          expected,
          similarityThreshold,
        );

        if (!meetsThreshold) {
          logger.error({
            message: `Field "${fieldName}" does not meet similarity threshold`,
            level: 0,
            auxiliary: {
              field: { value: fieldName, type: "string" },
              similarity: { value: similarity.toFixed(2), type: "float" },
              expected: { value: expected, type: "string" },
              actual: { value: actual, type: "string" },
            },
          });
        }

        return meetsThreshold;
      };

      const compareItem = (
        actual: { name: string; phone_number: string; address: string },
        expected: { name: string; phone_number: string; address: string },
        position: string,
      ): boolean => {
        const fields = [
          { field: "name", actual: actual.name, expected: expected.name },
          {
            field: "phone_number",
            actual: actual.phone_number,
            expected: expected.phone_number,
          },
          {
            field: "address",
            actual: actual.address,
            expected: expected.address,
          },
        ];

        return fields.every(({ field, actual, expected }) =>
          compareField(actual, expected, `${position} ${field}`),
        );
      };

      const allItemsMatch = validHealthCenters.every((center, index) =>
        compareItem(center, expectedHealthCenters[index], `Item ${index + 1}`),
      );

      if (!allItemsMatch) {
        return {
          _success: false,
          error: "One or more fields do not match expected values",
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
        error: String(error),
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    } finally {
      await stagehand.close();
    }
  },
);
