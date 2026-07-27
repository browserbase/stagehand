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
  { name: "extract_public_notices" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/sars/",
        { waitUntil: "load" },
      );

      const result = await stagehand.extract(
        "Extract ALL the public notice descriptions with their corresponding, GG number and publication date. Extract ALL notices from 2024 through 2020. Do not include the Notice number.",
        z.object({
          public_notices: z.array(
            z.object({
              notice_description: z
                .string()
                .describe(
                  "the description of the notice. Do not include the Notice number",
                ),
              gg_number: z
                .string()
                .describe("the GG number of the notice. For example, GG 12345"),
              publication_date: z
                .string()
                .describe(
                  "the publication date of the notice. For example, 8 December 2021",
                ),
            }),
          ),
        }),
      );

      const publicNotices = result.public_notices;
      const expectedLength = 24;

      const expectedFirstItem = {
        notice_description:
          "Additional considerations in terms of section 80(2) in respect of which an application for a binding private ruling or a binding class ruling may be rejected",
        gg_number: "GG 51526",
        publication_date: "8 November 2024",
      };

      const expectedLastItem = {
        notice_description:
          "Notice in terms of section 25, read with section 66(1) of the Income Tax Act, 1962, for submission of 2020 income tax returns",
        gg_number: "GG 43495",
        publication_date: "3 July 2020",
      };

      if (publicNotices.length !== expectedLength) {
        logger.error({
          message: "Incorrect number of public notices extracted",
          level: 0,
          auxiliary: {
            expected: {
              value: expectedLength.toString(),
              type: "integer",
            },
            actual: {
              value: publicNotices.length.toString(),
              type: "integer",
            },
          },
        });
        return {
          _success: false,
          error: "Incorrect number of public notices extracted",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }
      // NOTE (preserved v3 quirk): compareStrings returns an object, which is
      // always truthy — these `&&` chains never actually gate on similarity.
      const firstItemMatches =
        compareStrings(
          publicNotices[0].notice_description,
          expectedFirstItem.notice_description,
          0.9,
        ) &&
        compareStrings(
          publicNotices[0].gg_number,
          expectedFirstItem.gg_number,
          0.9,
        ) &&
        compareStrings(
          publicNotices[0].publication_date,
          expectedFirstItem.publication_date,
          0.9,
        );

      if (!firstItemMatches) {
        logger.error({
          message: "First public notice extracted does not match expected",
          level: 0,
          auxiliary: {
            expected: {
              value: JSON.stringify(expectedFirstItem),
              type: "object",
            },
            actual: {
              value: JSON.stringify(publicNotices[0]),
              type: "object",
            },
          },
        });
        return {
          _success: false,
          error: "First public notice extracted does not match expected",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }

      const lastItemMatches =
        compareStrings(
          publicNotices[publicNotices.length - 1].notice_description,
          expectedLastItem.notice_description,
          0.9,
        ) &&
        compareStrings(
          publicNotices[publicNotices.length - 1].gg_number,
          expectedLastItem.gg_number,
          0.9,
        ) &&
        compareStrings(
          publicNotices[publicNotices.length - 1].publication_date,
          expectedLastItem.publication_date,
          0.9,
        );

      if (!lastItemMatches) {
        logger.error({
          message: "Last public notice extracted does not match expected",
          level: 0,
          auxiliary: {
            expected: {
              value: JSON.stringify(expectedLastItem),
              type: "object",
            },
            actual: {
              value: JSON.stringify(publicNotices[publicNotices.length - 1]),
              type: "object",
            },
          },
        });
        return {
          _success: false,
          error: "Last public notice extracted does not match expected",
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
