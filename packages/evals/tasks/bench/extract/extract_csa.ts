import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { normalizeString } from "../../../framework/textScoring.js";

export default defineBenchTask(
  { name: "extract_csa" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/csa/");

      const { data: result } = await stagehand.extract(
        "Extract all the publications on the page including the publication date, session type, publication type, and annotation",
        z.object({
          publications: z.array(
            z.object({
              publication_date: z.string(),
              session_type: z.string(),
              publication_type: z.string(),
              annotation: z.string(),
            }),
          ),
        }),
      );

      const publications = result.publications;
      const expectedPublications = await page.evaluate(() =>
        Array.from(document.querySelectorAll("table tbody tr")).flatMap((row) => {
          const cells = Array.from(row.querySelectorAll(":scope > td"));
          if (cells.length !== 5) return [];
          return [
            {
              publication_date: cells[0]?.textContent?.trim() ?? "",
              session_type: cells[2]?.textContent?.trim() ?? "",
              publication_type: cells[3]?.textContent?.trim() ?? "",
              annotation: cells[4]?.textContent?.trim() ?? "",
            },
          ];
        }),
      );
      const key = (publication: {
        publication_date: string;
        session_type: string;
        publication_type: string;
        annotation: string;
      }) =>
        [
          normalizeString(publication.publication_date),
          normalizeString(publication.session_type),
          normalizeString(publication.publication_type),
          normalizeString(publication.annotation),
        ].join("|");
      const actualKeys = publications.map(key).sort();
      const expectedKeys = expectedPublications.map(key).sort();
      const allPublicationsMatch =
        actualKeys.length === expectedKeys.length &&
        JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);

      if (!allPublicationsMatch) {
        logger.error({
          message: "Extracted publications do not match the page",
          level: 0,
          auxiliary: {
            expected: { value: JSON.stringify(expectedPublications), type: "object" },
            actual: { value: JSON.stringify(publications), type: "object" },
          },
        });
        return {
          _success: false,
          error: "Extracted publications do not match the page",
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
    }
  },
);
