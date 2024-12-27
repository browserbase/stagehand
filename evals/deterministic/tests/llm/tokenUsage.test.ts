import { test } from "@playwright/test";
import { z } from "zod";
import { Stagehand } from "../../../../lib";
import StagehandConfig from "../../stagehand.config";

test.describe("Token Usage Tracking", () => {
  test.setTimeout(120000);

  let stagehand: Stagehand;

  test.beforeEach(async () => {
    stagehand = new Stagehand(StagehandConfig);
    await stagehand.init();
  });

  test.afterEach(async () => {
    await stagehand.close();
  });

  // E-commerce scenarios
  test("should track tokens when browsing Amazon product details", async () => {
    const page = stagehand.page;
    await page.goto(
      "https://www.amazon.com/Hitchhikers-Guide-Galaxy-Douglas-Adams/dp/0345418913",
    );

    // Extract product information
    const schema = z.object({
      productName: z.string(),
      price: z.string(),
      rating: z.string().optional(),
    });

    const result = await page.extract<typeof schema>({
      instruction:
        "get the product name, current price, and rating from this product",
      schema,
      useVision: true,
    });

    const tokenUsage = result._stagehandTokenUsage;
    if (tokenUsage) {
      console.log(
        `\n\x1b[1mAMAZON-PRODUCT-EXTRACT Token Usage:\x1b[0m
        \x1b[36mPrompt Tokens:     ${tokenUsage.promptTokens.toString().padStart(6)}\x1b[0m
        \x1b[32mCompletion Tokens: ${tokenUsage.completionTokens.toString().padStart(6)}\x1b[0m
        \x1b[33mTotal Tokens:      ${tokenUsage.totalTokens.toString().padStart(6)}\x1b[0m`,
      );
    }
  });

  // Github data extraction
  test("should track tokens when parsing Github repos", async () => {
    const page = stagehand.page;
    await page.goto(
      "https://github.com/microsoft/TypeScript/blob/main/README.md",
    );

    const schema = z.object({
      installationSteps: z.array(z.string()),
      requirements: z.array(z.string()),
      documentation: z.object({
        quickStart: z.string(),
        handbook: z.string().optional(),
        samples: z.array(z.string()).optional(),
      }),
    });

    const result = await page.extract<typeof schema>({
      instruction:
        "extract the installation steps, requirements, and documentation information from the TypeScript README",
      schema,
      useVision: false,
    });

    const tokenUsage = result._stagehandTokenUsage;
    if (tokenUsage) {
      console.log(
        `\n\x1b[1mGITHUB-README-EXTRACT Token Usage:\x1b[0m
        \x1b[36mPrompt Tokens:     ${tokenUsage.promptTokens.toString().padStart(6)}\x1b[0m
        \x1b[32mCompletion Tokens: ${tokenUsage.completionTokens.toString().padStart(6)}\x1b[0m
        \x1b[33mTotal Tokens:      ${tokenUsage.totalTokens.toString().padStart(6)}\x1b[0m`,
      );
    }
  });

  // Weather data extraction
  test("should track tokens when extracting weather data from Weather.gov", async () => {
    const page = stagehand.page;
    await page.goto(
      "https://forecast.weather.gov/MapClick.php?lat=32.7158&lon=-117.1638",
    );

    const schema = z.object({
      currentConditions: z.object({
        temperature: z.string(),
        humidity: z.string(),
        windSpeed: z.string(),
        forecast: z.string(),
      }),
      alerts: z
        .array(
          z.object({
            type: z.string(),
            severity: z.string(),
            description: z.string(),
          }),
        )
        .optional(),
    });

    const result = await page.extract<typeof schema>({
      instruction:
        "extract the current weather conditions including temperature, humidity, wind speed, and forecast. Also get any active weather alerts if present",
      schema,
      useVision: true,
    });

    const tokenUsage = result._stagehandTokenUsage;
    if (tokenUsage) {
      console.log(
        `\n\x1b[1mWEATHER-DATA-EXTRACT Token Usage:\x1b[0m
        \x1b[36mPrompt Tokens:     ${tokenUsage.promptTokens.toString().padStart(6)}\x1b[0m
        \x1b[32mCompletion Tokens: ${tokenUsage.completionTokens.toString().padStart(6)}\x1b[0m
        \x1b[33mTotal Tokens:      ${tokenUsage.totalTokens.toString().padStart(6)}\x1b[0m`,
      );
    }
  });
});
