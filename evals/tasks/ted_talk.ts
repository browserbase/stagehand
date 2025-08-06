import { EvalFunction } from "@/types/evals";
import { normalizeString } from "@/evals/utils";
import { z } from "zod/v3";

export const ted_talk: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  stagehand,
  logger,
}) => {
  try {
    await stagehand.page.goto(
      "https://www.ted.com/talks/sir_ken_robinson_do_schools_kill_creativity",
      {
        waitUntil: "domcontentloaded",
      },
    );

    await stagehand.page.act({
      action: "scroll 10% down the page",
    });

    await new Promise((resolve) => setTimeout(resolve, 5000));

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
    });

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

    if (!playlists.playlists || playlists.playlists.length === 0) {
      logger.error({
        message: "Failed to extract playlists on culture",
        level: 0,
      });

      return {
        _success: false,
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const missingPlaylists = expectedPlaylists.filter((expected) =>
      playlists.playlists.every(
        (extracted) =>
          normalizeString(extracted.title) !==
            normalizeString(expected.title) ||
          extracted.num_talks !== expected.num_talks,
      ),
    );

    if (missingPlaylists.length > 0) {
      logger.error({
        message: "Extracted playlists do not match expected playlists",
        level: 0,
        auxiliary: {
          missing: {
            value: JSON.stringify(missingPlaylists),
            type: "object",
          },
          extracted: {
            value: JSON.stringify(playlists.playlists),
            type: "object",
          },
        },
      });

      return {
        _success: false,
        error: "Extracted playlists do not match expected playlists",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    return {
      _success: true,
      playlists: playlists.playlists,
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
