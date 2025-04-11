import { EvalFunction } from "@/types/evals";
import { z } from "zod";

export const extract_hamilton_weather: EvalFunction = async ({
  logger,
  useTextExtract,
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
      useTextExtract,
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
      weatherData.temperature === expectedWeatherData.temperature &&
      weatherData.weather_description ===
        expectedWeatherData.weather_description &&
      weatherData.wind === expectedWeatherData.wind &&
      weatherData.humidity === expectedWeatherData.humidity &&
      weatherData.barometer === expectedWeatherData.barometer &&
      weatherData.visibility === expectedWeatherData.visibility;

    await stagehand.close();

    return {
      _success: isWeatherCorrect,
      weatherData,
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  } catch (error) {
    console.error("Error or timeout occurred:", error);

    await stagehand.close();

    return {
      _success: false,
      error: JSON.parse(JSON.stringify(error, null, 2)),
      debugUrl,
      sessionUrl,
      logs: logger.getLogs(),
    };
  }
};
