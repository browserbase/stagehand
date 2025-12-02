import { EvalFunction } from "../types/evals";
import { z } from "zod";

export const imdb_movie_details: EvalFunction = async ({
  debugUrl,
  sessionUrl,
  v3,
  logger,
}) => {
  try {
    const page = v3.context.pages()[0];
    await page.goto("https://www.imdb.com/title/tt0111161/", {
      waitUntil: "domcontentloaded",
    });
    await v3.act("click on the movie ratings");

    const movieDetails = await v3.extract(
      "Extract the list of countries with the most ratings.",
      z.object({
        countries: z
          .array(z.string())
          .describe("List of countries with the most ratings"),
      }),
    );

    const expectedCountries = [
      "United States",
      "United Kingdom",
      "Turkey",
      "India",
      "Germany",
    ];

    if (!movieDetails.countries || movieDetails.countries.length !== 5) {
      logger.error({
        message: "Failed to extract exactly five countries",
        level: 0,
        auxiliary: {
          expected: {
            value: JSON.stringify(expectedCountries),
            type: "object",
          },
          actual: {
            value: JSON.stringify(movieDetails.countries || []),
            type: "object",
          },
        },
      });

      return {
        _success: false,
        error: "Incorrect number of countries extracted",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    const missingCountries = expectedCountries.filter(
      (country) => !movieDetails.countries.includes(country),
    );

    if (missingCountries.length > 0) {
      logger.error({
        message: "Extracted countries do not match expected countries",
        level: 0,
        auxiliary: {
          missing: {
            value: JSON.stringify(missingCountries),
            type: "object",
          },
          extracted: {
            value: JSON.stringify(movieDetails.countries),
            type: "object",
          },
        },
      });

      return {
        _success: false,
        error: "Extracted countries do not match expected countries",
        logs: logger.getLogs(),
        debugUrl,
        sessionUrl,
      };
    }

    return {
      _success: true,
      countries: movieDetails.countries,
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
    await v3.close();
  }
};
