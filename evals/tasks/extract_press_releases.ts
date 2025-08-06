import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";
import { compareStrings } from "@/evals/utils";

export const extract_press_releases: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  const schema = z.object({
    items: z.array(
      z.object({
        title: z.string().describe("The title of the press release"),
        publish_date: z
          .string()
          .describe("The date the press release was published"),
      }),
    ),
  });

  type PressRelease = z.infer<typeof schema>["items"][number];

  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/press-releases/",
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));

    const rawResult = await stagehand.page.extract({
      instruction:
        "extract the title and corresponding publish date of EACH AND EVERY press releases on this page. DO NOT MISS ANY PRESS RELEASES.",
      schema,
    });

    const parsed = schema.parse(rawResult);
    const { items } = parsed;

    const expectedLength = 28;
    const expectedFirstItem: PressRelease = {
      title: "UAW Region 9A Endorses Brad Lander for Mayor",
      publish_date: "Dec 4, 2024",
    };
    const expectedLastItem: PressRelease = {
      title: "Fox Sued by New York City Pension Funds Over Election Falsehoods",
      publish_date: "Nov 12, 2023",
    };

    if (items.length <= expectedLength) {
      logger.error({
        message: "Not enough items extracted",
        level: 0,
        auxiliary: {
          expected: {
            value: `> ${expectedLength}`,
            type: "string",
          },
          actual: {
            value: items.length.toString(),
            type: "integer",
          },
        },
      });
      return {
        _success: false,
        error: "Not enough items extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const isItemMatch = (item: PressRelease, expected: PressRelease) => {
      const titleComparison = compareStrings(item.title, expected.title, 0.9);
      const dateComparison = compareStrings(
        item.publish_date,
        expected.publish_date,
        0.9,
      );
      return titleComparison.meetsThreshold && dateComparison.meetsThreshold;
    };

    const foundFirstItem = items.some((item) =>
      isItemMatch(item, expectedFirstItem),
    );
    const foundLastItem = items.some((item) =>
      isItemMatch(item, expectedLastItem),
    );

    return {
      _success: foundFirstItem && foundLastItem,
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } catch (error) {
    logger.error({
      message: `Error in extract_press_releases function`,
      level: 0,
      auxiliary: {
        error: {
          value: (error as Error).message || JSON.stringify(error),
          type: "string",
        },
        trace: {
          value: (error as Error).stack,
          type: "string",
        },
      },
    });
    return {
      _success: false,
      error: "An error occurred during extraction",
      logs: logger.getLogs(),
      debugUrl,
      sessionUrl,
    };
  } finally {
    await stagehand.close();
  }
};
