import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { normalizeString } from "../../../framework/textScoring.js";

export default defineBenchTask(
  { name: "extract_public_notices" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/sars/", {
        waitUntil: "load",
      });

      const { data: result } = await stagehand.extract(
        "Extract ALL the public notice descriptions with their corresponding, GG number and publication date. Extract ALL notices from 2024 through 2020. Do not include the Notice number.",
        z.object({
          public_notices: z.array(
            z.object({
              notice_description: z
                .string()
                .describe("the description of the notice. Do not include the Notice number"),
              gg_number: z.string().describe("the GG number of the notice. For example, GG 12345"),
              publication_date: z
                .string()
                .describe("the publication date of the notice. For example, 8 December 2021"),
            }),
          ),
        }),
      );

      const publicNotices = result.public_notices;
      const expectedNotices = await page.evaluate(() => {
        const table = Array.from(document.querySelectorAll("table")).find((candidate) => {
          const text = candidate.textContent ?? "";
          return text.includes("GG 51526") && text.includes("GG 43495");
        });
        if (!table) return [];
        return Array.from(table.querySelectorAll(":scope > tbody > tr")).flatMap((row) => {
          const cells = Array.from(row.querySelectorAll(":scope > td"));
          if (cells.length !== 4) return [];
          const publication_date = (cells[0]?.textContent ?? "")
            .replace(/New!/gi, "")
            .replace(/\u00a0/g, " ")
            .trim();
          const gg_number = (cells[1]?.textContent ?? "").match(/GG\s+\d+/)?.[0] ?? "";
          const year = Number(publication_date.match(/\b(20\d{2})\b/)?.[1]);
          return year >= 2020 && year <= 2024 ? [{ gg_number, publication_date }] : [];
        });
      });
      const key = (notice: { gg_number: string; publication_date: string }) =>
        `${normalizeString(notice.gg_number)}|${normalizeString(notice.publication_date)}`;
      const actualKeys = publicNotices.map(key).sort();
      const expectedKeys = expectedNotices.map(key).sort();
      const allNoticesMatch =
        actualKeys.length === expectedKeys.length &&
        publicNotices.every((notice) => notice.notice_description.trim().length > 0) &&
        JSON.stringify(actualKeys) === JSON.stringify(expectedKeys);

      if (!allNoticesMatch) {
        logger.error({
          message: "Extracted public notices do not match the page",
          level: 0,
          auxiliary: {
            expected: { value: JSON.stringify(expectedNotices), type: "object" },
            actual: { value: JSON.stringify(publicNotices), type: "object" },
          },
        });
        return {
          _success: false,
          error: "Extracted public notices do not match the page",
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
