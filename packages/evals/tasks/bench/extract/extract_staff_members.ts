import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { normalizeString } from "../../../framework/textScoring.js";

export default defineBenchTask(
  { name: "extract_staff_members" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/panamcs/");

      const { data: result } = await stagehand.extract(
        "extract a list of ALL the staff members on this page, with their name and their job title",
        z.object({
          staff_members: z.array(
            z.object({
              name: z.string(),
              job_title: z.string(),
            }),
          ),
        }),
      );

      const expectedStaff = await page.evaluate(() =>
        Array.from(document.querySelectorAll(".team-tiles .team-tile")).map((tile) => ({
          name: tile.querySelector("h3")?.textContent?.trim() ?? "",
          job_title: tile.querySelector("h4")?.textContent?.trim() ?? "",
        })),
      );
      const key = (member: { name: string; job_title: string }) =>
        `${normalizeString(member.name)}|${normalizeString(member.job_title)}`;
      const actualKeys = result.staff_members.map(key).sort();
      const expectedKeys = expectedStaff.map(key).sort();
      const allStaffMatch =
        actualKeys.length === expectedKeys.length &&
        JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);

      if (!allStaffMatch) {
        logger.error({
          message: "Extracted staff members do not match the page",
          level: 0,
          auxiliary: {
            expected: { value: JSON.stringify(expectedStaff), type: "object" },
            actual: { value: JSON.stringify(result.staff_members), type: "object" },
          },
        });
        return {
          _success: false,
          error: "Extracted staff members do not match the page",
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
    } finally {
      await stagehand.close();
    }
  },
);
