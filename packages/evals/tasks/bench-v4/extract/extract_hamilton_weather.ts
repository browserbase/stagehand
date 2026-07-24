import { z } from "zod";
import { defineBenchV4Task } from "../../../framework/defineTask.js";

/**
 * Inlined behavior-identical copies of `normalizeString`/`compareStrings` from
 * stagehand packages/evals/utils.ts and the `jaroWinkler` similarity from
 * string-comparison@1.3.0 — v4 eval tasks may only import "zod" and
 * "../../framework.js". Pure computation, no behavior change.
 */
function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[;/#!$%^&*:{}=\-_`~()]/g, "")
    .replace(/\s*,\s*/g, ", ")
    .trim();
}

function jaroSimilarity(first: string, second: string): number {
  // string-comparison initParams: strip all whitespace + lowercase
  const s1 = first.replace(/\s+/g, "").toLowerCase();
  const s2 = second.replace(/\s+/g, "").toLowerCase();
  if (!s1.length && !s2.length) return 1;
  if (!s1.length || !s2.length) return 0;
  if (s1 === s2) return 1;
  const len1 = s1.length;
  const len2 = s2.length;
  if (len1 === 0 || len2 === 0) return 0;
  const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
  let matches = 0;
  const s1Matches = new Array(s1.length).fill(0);
  const s2Matches = new Array(s2.length).fill(0);
  for (let i = 0; i < len1; i++) {
    for (
      let j = Math.max(0, i - matchWindow);
      j < Math.min(len2, i + matchWindow + 1);
      j++
    ) {
      if (s1[i] === s2[j] && s2Matches[j] === 0) {
        s1Matches[i] = 1;
        s2Matches[j] = 1;
        matches++;
        break;
      }
    }
  }
  if (matches === 0) return 0;
  let transpositions = 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (s1Matches[i] === 1) {
      while (s2Matches[k] === 0) k++;
      if (s1[i] !== s2[k++]) transpositions++;
    }
  }
  transpositions /= 2;
  return (
    (matches / len1 + matches / len2 + (matches - transpositions) / matches) / 3
  );
}

function jaroWinklerSimilarity(a: string, b: string): number {
  let sim = jaroSimilarity(a, b);
  if (sim > 0.7) {
    // NOTE: string-comparison computes the common prefix on the raw inputs
    // (pre-initParams), preserved here.
    let prefix = 0;
    for (let i = 0; i < Math.min(a.length, b.length) && a[i] === b[i]; i++) {
      prefix++;
    }
    prefix = Math.min(4, prefix);
    sim += 0.1 * prefix * (1 - sim);
  }
  return sim;
}

function compareStrings(
  actual: string,
  expected: string,
  similarityThreshold: number = 0.85,
): { similarity: number; meetsThreshold: boolean } {
  const similarity = jaroWinklerSimilarity(
    normalizeString(actual),
    normalizeString(expected),
  );
  return {
    similarity,
    meetsThreshold: similarity >= similarityThreshold,
  };
}

export default defineBenchV4Task(
  { name: "extract_hamilton_weather" },
  async ({ logger, debugUrl, sessionUrl, stagehand, page }) => {
    try {
      await page.goto(
        "https://browserbase.github.io/stagehand-eval-sites/sites/hamilton-weather/",
      );
      // NOTE: v3 passes a bare XPath here; ported verbatim on purpose.
      const xpath =
        "/html/body[1]/div[5]/main[1]/article[1]/div[6]/div[2]/div[1]/table[1]";

      const weatherData = await stagehand.extract(
        "extract the weather data for Sun, Feb 23 at 11PM",
        z.object({
          temperature: z.string(),
          weather_description: z.string(),
          wind: z.string(),
          humidity: z.string(),
          barometer: z.string(),
          visibility: z.string(),
        }),
        { selector: xpath },
      );

      // Define the expected weather data
      const expectedWeatherData = {
        temperature: "27 °F",
        weather_description: "Light snow. Overcast.",
        wind: "6 mph",
        humidity: "93%",
        barometer: '30.07 "Hg',
        visibility: "10 mi",
      };

      // Check that every field matches the expected value
      const isWeatherCorrect =
        compareStrings(
          weatherData.temperature,
          expectedWeatherData.temperature,
          0.9,
        ).meetsThreshold &&
        compareStrings(
          weatherData.weather_description,
          expectedWeatherData.weather_description,
          0.9,
        ).meetsThreshold &&
        compareStrings(weatherData.wind, expectedWeatherData.wind, 0.9)
          .meetsThreshold &&
        compareStrings(weatherData.humidity, expectedWeatherData.humidity, 0.9)
          .meetsThreshold &&
        compareStrings(
          weatherData.barometer,
          expectedWeatherData.barometer,
          0.9,
        ).meetsThreshold &&
        compareStrings(
          weatherData.visibility,
          expectedWeatherData.visibility,
          0.9,
        ).meetsThreshold;

      return {
        _success: isWeatherCorrect,
        weatherData,
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } catch (error) {
      return {
        _success: false,
        error: JSON.parse(JSON.stringify(error, null, 2)),
        debugUrl,
        sessionUrl,
        logs: logger.getLogs(),
      };
    } finally {
      await stagehand.close();
    }
  },
);
