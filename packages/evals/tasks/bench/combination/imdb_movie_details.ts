import { z } from "zod";
import { defineBenchTask } from "../../../framework/defineTask.js";

const EXPECTED_COUNTRIES = ["United States", "United Kingdom", "Turkey", "India", "Germany"];

export default defineBenchTask(
  { name: "imdb_movie_details" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto("https://www.imdb.com/title/tt0111161/", {
        waitUntil: "domcontentloaded",
      });
      await stagehand.act("click on the movie ratings");

      const { data } = await stagehand.extract(
        "Extract the list of countries with the most ratings.",
        z.object({
          countries: z.array(z.string()).describe("The countries with the most ratings"),
        }),
      );

      const success =
        data.countries.length === EXPECTED_COUNTRIES.length &&
        EXPECTED_COUNTRIES.every((country) => data.countries.includes(country));

      return {
        _success: success,
        countries: data.countries,
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
