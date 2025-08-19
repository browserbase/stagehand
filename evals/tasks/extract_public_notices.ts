import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";
import { compareStrings } from "@/evals/utils";

export const extract_public_notices: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/sars/",
      { waitUntil: "load" },
    );

    const result = await stagehand.page.extract({
      instruction:
        "Extract ALL the public notice descriptions with their corresponding, GG number and publication date. Extract ALL notices from 2024 through 2020. Do not include the Notice number.",
      schema: z.object({
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
    });

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
};
