import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod";

/**
 * Example of using Google Vertex AI directly (not through AI SDK).
 * When you provide `vertexai: true` in the client options,
 * the system will route to GoogleVertexClient instead of using AI SDK.
 */
async function main() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    modelName: "google/gemini-1.5-pro", // Google model with slash notation
    modelClientOptions: {
      // Vertex AI specific configuration - bypasses AI SDK
      vertexai: true,
      project: "your-gcp-project-id",
      location: "us-central1",
      // Optional: API key if not using default auth
      // apiKey: process.env.GOOGLE_API_KEY,
    },
  });

  await stagehand.init();
  const page = stagehand.context.pages()[0];
  await page.goto("https://docs.stagehand.dev");

  // Extract some text using Vertex AI (not AI SDK)
  const result = await stagehand.extract("extract the main heading of this page", z.object({
    heading: z.string(),
  }));

  console.log("Extracted:", result);
  await stagehand.close();
}

main().catch(console.error);
