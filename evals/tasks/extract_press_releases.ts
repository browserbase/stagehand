import { EvalFunction } from "@/types/evals";
import { z } from "zod";
import { compareStrings } from "@/evals/utils";

export const extract_press_releases: EvalFunction = async ({
  stagehand,
  modelName,
  logger,
  useTextExtract,
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

  await stagehand.page.goto(
    "https://www.sars.gov.za/media-release/media-releases/",
    { waitUntil: "load" },
  );

  const result = await stagehand.page.extract({
    instruction:
      "Extract ALL the press release titles with their corresponding publication date. Extract ALL press releases from 2024 through 2020. Do not include the Notice number.",
    schema,
    modelName,
    useTextExtract,
  });

  await stagehand.close();

  const pressReleases = result.items;
  const expectedLength = 24;

  const expectedFirstItem: PressRelease = {
    title:
      "SARS welcomes the appointment of the new Commissioner and Deputy Commissioner",
    publish_date: "8 November 2024",
  };

  const expectedLastItem: PressRelease = {
    title:
      "SARS welcomes the appointment of the new Commissioner and Deputy Commissioner",
    publish_date: "3 July 2020",
  };

  if (pressReleases.length !== expectedLength) {
    logger.error({
      message: "Incorrect number of press releases extracted",
      level: 0,
      auxiliary: {
        expected: {
          value: expectedLength.toString(),
          type: "integer",
        },
        actual: {
          value: pressReleases.length.toString(),
          type: "integer",
        },
      },
    });
    return {
      _success: false,
      error: "Incorrect number of press releases extracted",
      logs: logger.getLogs(),
    };
  }

  const firstItemMatches =
    compareStrings(pressReleases[0].title, expectedFirstItem.title, 0.9)
      .meetsThreshold &&
    compareStrings(
      pressReleases[0].publish_date,
      expectedFirstItem.publish_date,
      0.9,
    ).meetsThreshold;

  if (!firstItemMatches) {
    logger.error({
      message: "First press release extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedFirstItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(pressReleases[0]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "First press release extracted does not match expected",
      logs: logger.getLogs(),
    };
  }

  const lastItemMatches =
    compareStrings(
      pressReleases[pressReleases.length - 1].title,
      expectedLastItem.title,
      0.9,
    ).meetsThreshold &&
    compareStrings(
      pressReleases[pressReleases.length - 1].publish_date,
      expectedLastItem.publish_date,
      0.9,
    ).meetsThreshold;

  if (!lastItemMatches) {
    logger.error({
      message: "Last press release extracted does not match expected",
      level: 0,
      auxiliary: {
        expected: {
          value: JSON.stringify(expectedLastItem),
          type: "object",
        },
        actual: {
          value: JSON.stringify(pressReleases[pressReleases.length - 1]),
          type: "object",
        },
      },
    });
    return {
      _success: false,
      error: "Last press release extracted does not match expected",
      logs: logger.getLogs(),
    };
  }

  return {
    _success: true,
    logs: logger.getLogs(),
  };
};
