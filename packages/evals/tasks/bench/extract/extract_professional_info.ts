import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";
import { normalizeString } from "../../../scoring.js";

export default defineBenchTask(
  { name: "extract_professional_info" },
  async ({ debugUrl, sessionUrl, stagehand, page, logger }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/professional-info/",
      );

      const { data: result } = await stagehand.extract(
        "Extract the list of Practices, phone number, and fax number of the professional.",
        z.object({
          practices: z.array(z.string()),
          phone: z.string(),
          fax: z.string(),
        }),
      );

      const { practices, phone, fax } = result;

      const expected = {
        practices: [
          "Restructuring",
          "Finance",
          "Hybrid Capital & Special Situations",
          "Private Credit",
        ],
        phone: "+1-212-373-3262",
        fax: "+1-212-492-0262",
      };

      if (
        JSON.stringify(practices.map(normalizeString)) !==
        JSON.stringify(expected.practices.map(normalizeString))
      ) {
        logger.error({
          message: "Practices extracted do not match expected",
          level: 0,
          auxiliary: {
            expected: {
              value: JSON.stringify(expected.practices),
              type: "object",
            },
            actual: {
              value: JSON.stringify(practices),
              type: "object",
            },
          },
        });
        return {
          _success: false,
          error: "Practices extracted do not match expected",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }

      if (normalizeString(phone) !== normalizeString(expected.phone)) {
        logger.error({
          message: "Phone number extracted does not match expected",
          level: 0,
          auxiliary: {
            expected: {
              value: normalizeString(expected.phone),
              type: "string",
            },
            actual: {
              value: normalizeString(phone),
              type: "string",
            },
          },
        });
        return {
          _success: false,
          error: "Phone number extracted does not match expected",
          logs: logger.getLogs(),
          debugUrl,
          sessionUrl,
        };
      }

      if (normalizeString(fax) !== normalizeString(expected.fax)) {
        logger.error({
          message: "Fax number extracted does not match expected",
          level: 0,
          auxiliary: {
            expected: {
              value: normalizeString(expected.fax),
              type: "string",
            },
            actual: {
              value: normalizeString(fax),
              type: "string",
            },
          },
        });
        return {
          _success: false,
          error: "Fax number extracted does not match expected",
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
