import { EvalFunction } from "@/types/evals";
import { normalizeString } from "@/evals/utils";
import { z } from "zod";

export const ted_talk: EvalFunction = async ({
  stagehand,
  modelName,
  logger,
  useTextExtract,
}) => {
  await stagehand.page.goto(
    "https://www.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity",
    {
      waitUntil: "domcontentloaded",
    },
  );
  await stagehand.page.act({
    action:
      "Click the link that takes you to the page about the 'Culture' topic",
  });

  const playlists = await stagehand.page.extract({
    instruction:
      "Extract the video playlist titles and the number of talks in each playlist. This info is in the Video Playlists about Culture section of the webpage.",
    schema: z.object({
      playlists: z
        .array(
          z.object({
            title: z.string().describe("Title of the playlist"),
            num_talks: z.number().describe("Number of talks in the playlist"),
          }),
        )
        .describe("List of culture video playlists"),
    }),
    modelName,
    useTextExtract,
  });

  await stagehand.close();

  const expectedPlaylists = [
    {
      title: "Talks that celebrate the boundless creativity of an open mind",
      num_talks: 6,
    },
    {
      title: "Little-known big history",
      num_talks: 15,
    },
    {
      title: "Extraordinary, larger-than-life art",
      num_talks: 10,
    },
    {
      title: "How perfectionism fails us",
      num_talks: 4,
    },
  ];

  const foundPlaylists = playlists.playlists;

  if (foundPlaylists.length !== expectedPlaylists.length) {
    logger.error({
      message: "Incorrect number of playlists extracted",
      level: 0,
      auxiliary: {
        expected: {
          value: expectedPlaylists.length.toString(),
          type: "integer",
        },
        actual: {
          value: foundPlaylists.length.toString(),
          type: "integer",
        },
      },
    });
    return {
      _success: false,
      error: "Incorrect number of playlists extracted",
      logs: logger.getLogs(),
    };
  }

  for (let i = 0; i < expectedPlaylists.length; i++) {
    const expected = expectedPlaylists[i];
    const found = foundPlaylists[i];

    if (
      !normalizeString(found.title).includes(normalizeString(expected.title)) ||
      found.num_talks !== expected.num_talks
    ) {
      logger.error({
        message: "Playlist details do not match expected",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expected),
            type: "object",
          },
          actual: {
            value: JSON.stringify(found),
            type: "object",
          },
        },
      });
      return {
        _success: false,
        error: "Playlist details do not match expected",
        logs: logger.getLogs(),
      };
    }
  }

  return {
    _success: true,
    playlists: foundPlaylists,
    logs: logger.getLogs(),
  };
};
