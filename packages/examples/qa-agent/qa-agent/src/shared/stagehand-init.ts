import { Stagehand } from "@browserbasehq/stagehand";
import "dotenv/config";

export async function createStagehand() {
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    apiKey: process.env.BROWSERBASE_API_KEY!,
    projectId: process.env.BROWSERBASE_PROJECT_ID!,
    verbose: 1,
    experimental: true, // Required for hybrid mode
    modelName: "openai/gpt-4o",
    modelClientOptions: {
      apiKey: process.env.OPENAI_API_KEY!,
    },
  });

  await stagehand.init();
  console.log("🌐 Stagehand initialized with Browserbase");
  console.log(`📺 Watch the session at: https://www.browserbase.com/sessions`);

  // Set extra headers to bypass ngrok interstitial warning page
  await stagehand.page.setExtraHTTPHeaders({
    "ngrok-skip-browser-warning": "true",
  });

  return stagehand;
}
