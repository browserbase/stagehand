// Stagehand + Browserbase: Weather Proxy Demo - See README.md for full documentation

import "dotenv/config";
import { browserbase, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

interface GeolocationConfig {
  city: string;
  country: string;
  state?: string;
}

interface WeatherResult {
  city: string;
  country: string;
  temperature: number;
  unit: string;
  conditions: string;
  reportedLocation: string;
  reportedCountry: string;
  error?: string;
}

const WeatherSchema = z.object({
  temperature: z.number().describe("Current temperature in degrees Celsius"),
  conditions: z.string().min(1).describe("Current weather description"),
  reportedLocation: z.string().min(1).describe("Nearest reported city or area"),
  reportedCountry: z.string().min(1).describe("Reported country name"),
});

const EXPECTED_COUNTRIES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  JP: "Japan",
  BR: "Brazil",
};

async function closeSession(
  stagehand: Stagehand,
  browser: Awaited<ReturnType<typeof browserbase.launch>>,
) {
  await stagehand.close().catch((error) => console.warn("Stagehand cleanup warning:", error));
  await browser.close().catch((error) => console.warn("Browser cleanup warning:", error));
}

// Fetches weather data for a specific location using geolocation proxies
// Configures Stagehand with location-specific proxy, navigates to weather site,
// and extracts temperature data using Stagehand's structured extraction capabilities
async function getWeatherForLocation(geolocation: GeolocationConfig): Promise<WeatherResult> {
  const cityName = geolocation.city.replace(/_/g, " ");
  console.log(`\n=== Getting weather for ${cityName}, ${geolocation.country} ===`);

  // Initialize Stagehand with geolocation proxy configuration
  // This ensures all browser traffic routes through the specified geographic location
  const browser = await browserbase.launch({
    apiKey: process.env.BROWSERBASE_API_KEY!,
    proxies: [
      {
        type: "browserbase", // Use Browserbase's managed proxy infrastructure for reliable geolocation routing
        geolocation: {
          city: geolocation.city, // City name (case-insensitive, e.g., "NEW_YORK", "new_york", "New York" all work)
          country: geolocation.country, // ISO country code (case-insensitive, e.g., "US", "us", "gb", "GB" all work)
          ...(geolocation.state && { state: geolocation.state }), // State required for US locations (case-insensitive)
        },
      },
    ],
  });
  const stagehand = await Stagehand.create({ browser: browser, logging: { level: "error" } });

  try {
    // Initialize browser session to start automation
    console.log(`Initializing Stagehand for ${cityName}...`);

    console.log(`Stagehand initialized successfully for ${cityName}`);

    const page = (await browser.context.pages())[0];

    // Navigate to weather service - geolocation proxy ensures location-specific weather data
    console.log(`Navigating to weather service for ${cityName}...`);
    await page.goto("https://wttr.in/?format=j1", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    console.log(`Page loaded for ${cityName}`);

    // wttr.in derives the location from the proxied IP and returns current
    // conditions as JSON; Stagehand turns that response into the template schema.
    console.log(`Extracting current weather data for ${cityName}...`);
    const { data: weather } = await stagehand.extract(
      "Extract the current temperature in Celsius, weather description, nearest reported city or area, and reported country from this weather JSON",
      WeatherSchema,
    );
    const { temperature, conditions, reportedLocation, reportedCountry } = weather;

    const expectedCountry = EXPECTED_COUNTRIES[geolocation.country];
    if (!Number.isFinite(temperature)) {
      throw new Error("Weather service did not return a numeric current temperature");
    }
    if (!reportedCountry.toLowerCase().includes(expectedCountry.toLowerCase())) {
      throw new Error(
        `Proxy location mismatch: expected ${expectedCountry}, received ${reportedCountry}`,
      );
    }

    console.log(
      `Successfully read weather near ${reportedLocation}, ${reportedCountry}: ${temperature} °C, ${conditions}`,
    );

    // Close Stagehand session to release resources
    await closeSession(stagehand, browser);

    return {
      city: cityName,
      country: geolocation.country,
      temperature,
      unit: "°C",
      conditions,
      reportedLocation,
      reportedCountry,
    };
  } catch (error) {
    await closeSession(stagehand, browser);
    console.error(`Error getting weather for ${cityName}:`, error);
    return {
      city: cityName,
      country: geolocation.country,
      temperature: 0,
      unit: "",
      conditions: "",
      reportedLocation: "",
      reportedCountry: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

// Displays formatted weather results for all processed locations
// Shows successful results with temperature data or error messages for failed locations
function displayResults(results: WeatherResult[]) {
  console.log("\n=== Weather Results ===");

  for (const result of results) {
    if (result.error) {
      console.log(`${result.city}, ${result.country}: Error - ${result.error}`);
    } else {
      console.log(
        `${result.city}, ${result.country}: ${result.temperature} ${result.unit}, ${result.conditions} (reported near ${result.reportedLocation}, ${result.reportedCountry})`,
      );
    }
  }
}

// Main orchestration function: processes multiple locations sequentially using geolocation proxies
// Demonstrates how different proxy locations return different weather data from the same website
async function main() {
  // Define locations to test - demonstrating the power of geolocation proxies
  // Each location will route traffic through its respective geographic proxy to get location-specific weather
  // Note: All geolocation fields (city, country, state) are case-insensitive
  const locations: GeolocationConfig[] = [
    {
      city: "NEW_YORK",
      state: "NY", // State required for US locations (case-insensitive)
      country: "US",
    },
    {
      city: "LONDON",
      country: "GB",
    },
    {
      city: "TOKYO",
      country: "JP",
    },
    {
      city: "SAO_PAULO",
      country: "BR",
    },
  ];

  console.log("=== Weather Proxy Demo - Running Sequentially ===\n");
  console.log(`Processing ${locations.length} locations with geolocation proxies...`);
  console.log("Each location will use a different proxy to fetch location-specific weather data\n");

  // Collect all results for final summary
  const results: WeatherResult[] = [];

  // Run each location sequentially to show different weather based on proxy location
  // Sequential processing ensures clear demonstration of proxy-based location differences
  for (let i = 0; i < locations.length; i++) {
    const location = locations[i];
    console.log(
      `\n[${i + 1}/${locations.length}] Processing ${location.city}, ${location.country}...`,
    );
    const result = await getWeatherForLocation(location);
    results.push(result);
  }

  // Display all results in formatted summary
  displayResults(results);

  const failures = results.filter((result) => result.error);
  if (failures.length > 0) {
    throw new Error(
      `Weather extraction failed for ${failures.length} of ${results.length} locations`,
    );
  }

  console.log("\n=== All locations completed ===");
}

main().catch((err) => {
  console.error("Application error:", err);
  console.error("Common issues:");
  console.error("  - Check .env file has BROWSERBASE_API_KEY");
  console.error(
    "  - Verify geolocation proxy locations are valid (see https://docs.browserbase.com/features/proxies)",
  );
  console.error("  - Ensure locations array is properly configured");
  console.error("Docs: https://docs.stagehand.dev/v4/first-steps/introduction");
  process.exit(1);
});
