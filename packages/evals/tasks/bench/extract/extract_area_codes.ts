import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { normalizeString } from "../../../framework/textScoring.js";

export default defineBenchTask(
  { name: "extract_area_codes" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/ncc-area-codes/", {
        waitUntil: "domcontentloaded",
      });

      const { data: result } = await stagehand.extract(
        "Extract ALL the Primary Center names and their corresponding Area Code, and the name of their corresponding Zone.",
        z.object({
          primary_center_list: z.array(
            z.object({
              zone_name: z
                .string()
                .describe(
                  "The name of the Zone that the Primary Center is in. For example, 'North Central Zone'.",
                ),
              primary_center_name: z
                .string()
                .describe(
                  "The name of the Primary Center. I.e., this is the name of the city or town.",
                ),
              area_code: z
                .string()
                .describe(
                  "The area code for the Primary Center. This will either be 2 or 3 digits.",
                ),
            }),
          ),
        }),
      );

      const expectedPrimaryCenters = await page.evaluate(() => {
        const table = document.querySelector(".field--name-body table");
        if (!table) return [];
        let zone = "";
        return Array.from(table.querySelectorAll("tr")).flatMap((row) => {
          const header = row.querySelector(":scope > th")?.textContent?.trim();
          if (header) zone = header;
          const cells = Array.from(row.querySelectorAll(":scope > td")).map(
            (cell) => cell.textContent?.trim() ?? "",
          );
          if (cells.length < 2) return [];
          const [primary_center_name, area_code] = cells.slice(-2);
          if (!/^\d{2,3}$/.test(area_code)) return [];
          return [{ zone_name: zone, primary_center_name, area_code }];
        });
      });
      const key = (item: { zone_name: string; primary_center_name: string; area_code: string }) =>
        [
          normalizeString(item.zone_name),
          normalizeString(item.primary_center_name),
          item.area_code.trim(),
        ].join("|");
      const actualKeys = result.primary_center_list.map(key).sort();
      const expectedKeys = expectedPrimaryCenters.map(key).sort();
      const allPrimaryCentersMatch =
        actualKeys.length === expectedKeys.length &&
        JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);

      if (!allPrimaryCentersMatch) {
        logger.error({
          message: "Extracted primary centers do not match the page",
          level: 0,
          auxiliary: {
            expected: { value: JSON.stringify(expectedPrimaryCenters), type: "object" },
            actual: { value: JSON.stringify(result.primary_center_list), type: "object" },
          },
        });
        return {
          _success: false,
          error: "Extracted primary centers do not match the page",
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
