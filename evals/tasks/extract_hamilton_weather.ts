import { EvalFunction } from "@/types/evals";
import { z } from "zod/v3";
import { compareStrings } from "@/evals/utils";

export const extract_hamilton_weather: EvalFunction = async ({
  logger,
  debugUrl,
  sessionUrl,
  stagehand,
}) => {
  try {
    await stagehand.page.goto(
      "https://browserbase.github.io/stagehand-eval-sites/sites/hamilton-weather/",
    );
    const xpath =
      "/html/body[1]/div[5]/main[1]/article[1]/div[6]/div[2]/div[1]/table[1]";

    const weatherData = await stagehand.page.extract({
      instruction: "extract the weather data for Sun, Feb 23 at 11PM",
      schema: z.object({
        temperature: z.string(),
        weather_description: z.string(),
        wind: z.string(),
        humidity: z.string(),
        barometer: z.string(),
        visibility: z.string(),
      }),
      selector: xpath,
    });

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
      compareStrings(weatherData.barometer, expectedWeatherData.barometer, 0.9)
        .meetsThreshold &&
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
};
