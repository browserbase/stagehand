import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

/**
 * Inlined behavior-identical copies of `normalizeString`/`compareStrings` from
 * stagehand packages/evals/utils.ts and the `jaroWinkler` similarity from
 * string-comparison@1.3.0 — v4 eval tasks may only import "zod" and
 * "../../framework.js". Pure computation, no behavior change.
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[;/#!$%^&*:{}=\-_`~()]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function jaroSimilarity(first: string, second: string): number {
  // string-comparison initParams: strip all whitespace + lowercase
  const s1 = first.replace(/\s+/g, "").toLowerCase();
  const s2 = second.replace(/\s+/g, "").toLowerCase();
  if (!s1.length && !s2.length) return 1;
  if (!s1.length || !s2.length) return 0;
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  let matches = 0;
  const s1Matches = new Array(s1.length).fill(0);
  const s2Matches = new Array(s2.length).fill(0);
  for (let i = 0; i < len1; i++) {
    for (
      let j = Math.max(0, i - matchWindow);
      j < Math.min(len2, i + matchWindow + 1);
      j++
    ) {
      if (s1[i] === s2[j] && s2Matches[j] === 0) {
        s1Matches[i] = 1;
        s2Matches[j] = 1;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (s1Matches[i] === 1) {
      while (s2Matches[k] === 0) k++;
      if (s1[i] !== s2[k++]) transpositions++;
    }
  }
  transpositions /= 2;
  return (
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3
  );
}

function jaroWinklerSimilarity(a: string, b: string): number {
  let sim = jaroSimilarity(a, b);
  if (sim > 0.7) {
    // NOTE: string-comparison computes the common prefix on the raw inputs
    // (pre-initParams), preserved here.
    let prefix = 0;
    for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) {
      prefix++;
    }
    prefix = Math.min(4, prefix);
    sim += 0.1 * prefix * (1 - sim);
  }
  return sim;
}

function compareStrings(
  actual: string,
  expected: string,
  similarityThreshold: number = 0.85,
): { similarity: number; meetsThreshold: boolean } {
  const similarity = jaroWinklerSimilarity(
    normalizeString(actual),
    normalizeString(expected),
  );
  return {
    similarity,
    meetsThreshold: similarity >= similarityThreshold,
  };
}

export default defineBenchV4Task(
  { name: "extract_memorial_healthcare" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/mycmh/",
      );

      const result = await stagehand.extract(
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

      const expectedFirstItem = {
        name: "Community Memorial Breast Center",
        phone_number: "805-948-5093",
        address: "168 North Brent Street, Suite 401, Ventura, CA 93003",
      };

      const expectedLastItem = {
        name: "Community Memorial Dermatology and Mohs Surgery",
        phone_number: "805-948-6920",
        address: "168 North Brent Street, Suite 403, Ventura, CA 93003",
      };

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

      const validHealthCenters = health_centers
        .map(validateHealthCenter)
        .filter(Boolean) as Array<{
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

      const compareField = (
        actual: string,
        expected: string,
        fieldName: string,
      ): boolean => {
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

      const firstItemMatches = compareItem(
        validHealthCenters[0],
        expectedFirstItem,
        "First",
      );
      const lastItemMatches = compareItem(
        validHealthCenters[validHealthCenters.length - 1],
        expectedLastItem,
        "Last",
      );

      if (!firstItemMatches || !lastItemMatches) {
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
