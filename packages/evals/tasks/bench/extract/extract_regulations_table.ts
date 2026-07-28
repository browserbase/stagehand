import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { normalizeString } from "../../../framework/textScoring.js";

export default defineBenchTask(
  { name: "extract_regulations_table" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/ncc-numbering-plan/",
      );

      const tableSelector = "#field_csv-0-csvfiletable";

      const { data: allottees } = await stagehand.extract(
        "Extract ALL of the allottees and their corresponding name, area, area code, and access code.",
        z.object({
          allottee_list: z.array(
            z.object({
              allottee_name: z.string(),
              area: z.string(),
              area_code: z.string(),
              access_code: z.string(),
            }),
          ),
        }),
        { selector: tableSelector },
      );

      const allotteeList = allottees.allottee_list;
      const expectedAllottees = await page.evaluate((selector) => {
        const table = document.querySelector(selector);
        if (!table) throw new Error(`Expected regulations table not found: ${selector}`);
        return Array.from(table.querySelectorAll("tbody > tr")).flatMap((row) => {
          const cells = Array.from(row.querySelectorAll(":scope > td")).map(
            (cell) =>
              cell.querySelector(".tablesaw-cell-content")?.textContent?.trim() ??
              cell.textContent?.trim() ??
              "",
          );
          if (cells.length < 5) return [];
          return [
            {
              allottee_name: cells[1],
              area: cells[2],
              area_code: cells[3],
              access_code: cells[4],
            },
          ];
        });
      }, tableSelector);
      if (expectedAllottees.length === 0) {
        throw new Error("Expected regulations table contained no allottee rows");
      }
      const key = (item: {
        allottee_name: string;
        area: string;
        area_code: string;
        access_code: string;
      }) =>
        [
          normalizeString(item.allottee_name),
          normalizeString(item.area),
          item.area_code.trim(),
          item.access_code.trim(),
        ].join("|");
      const actualKeys = allotteeList.map(key).sort();
      const expectedKeys = expectedAllottees.map(key).sort();
      const isRegulationsCorrect =
        actualKeys.length === expectedKeys.length &&
        JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);

      return {
        _success: isRegulationsCorrect,
        regulationsData: allottees,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: String(error),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    }
  },
);
