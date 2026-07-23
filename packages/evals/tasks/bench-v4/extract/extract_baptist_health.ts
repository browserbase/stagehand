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
  { name: "extract_baptist_health" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/baptist-health/",
      );

      const result = await stagehand.extract(
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

      const compareField = (
        actualVal: string,
        expectedVal: string,
        fieldName: string,
      ) => {
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
          error: "Some fields did not meet similarity threshold",
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
