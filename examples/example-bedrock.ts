import { Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v3";

/**
 * AWS Bedrock Integration Example for Stagehand
 *
 * This example demonstrates how to use Stagehand with AWS Bedrock models.
 * Anthropic models work best for advanced features like structured extraction
 * and observation, while OpenAI models work well for navigation and basic operations.
 *
 * SETUP:
 *
 * 1. Enable model access in AWS Bedrock Console:
 *    - Visit: https://console.aws.amazon.com/bedrock/
 *    - Go to "Model access" → "Enable model access"
 *    - Enable desired models (e.g., Anthropic Claude, OpenAI models)
 *    - Wait for approval
 *
 * 2. Authentication (choose one):
 *
 *    Option A - Bearer Token:
 *    ```
 *    AWS_BEARER_TOKEN_BEDROCK=bedrock-api-key-[your-base64-token]
 *    ```
 *
 *    Option B - Standard AWS Credentials:
 *    ```
 *    AWS_ACCESS_KEY_ID=your-access-key
 *    AWS_SECRET_ACCESS_KEY=your-secret-key
 *    ```
 *
 * 3. Set region and model:
 *    ```
 *    AWS_REGION=us-east-1
 *    ```
 *
 * RECOMMENDED MODELS:
 * - anthropic.claude-3-5-sonnet-20240620-v1:0 (best for extraction/observation)
 * - anthropic.claude-3-haiku-20240307-v1:0 (faster, good for basic tasks)
 * - openai.gpt-oss-120b-1:0 (good for navigation and simple operations)
 */

async function runBedrockExample() {
  // Initialize Stagehand with AWS Bedrock
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    modelName: "bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0",
    modelClientOptions: {
      region: "us-west-2", // Will use environment variables if not specified
    },
  });

  try {
    await stagehand.init();
    const page = stagehand.page;

    console.log("🚀 Stagehand initialized with AWS Bedrock");

    // Navigate to a website
    await page.goto("https://example.com");
    console.log("📄 Navigated to example.com");

    // Perform actions on the page
    await page.act("click the link");
    console.log("🎯 Clicked the 'More information...' link");

    // Extract structured data
    const pageInfo = await page.extract({
      instruction: "Extract the page title and text",
      schema: z.object({
        title: z.string(),
        text: z.string(),
      }),
    });

    console.log("📊 Extracted data:", pageInfo);

    // Observe elements on the page
    const elements = await page.observe();
    console.log(`👀 Found ${elements.length} interactive elements`);

    console.log("✅ AWS Bedrock example completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error);

    // Common troubleshooting hints
    if (error.message?.includes("access")) {
      console.error("💡 Check model access in AWS Bedrock Console");
    } else if (
      error.message?.includes("credentials") ||
      error.message?.includes("authentication")
    ) {
      console.error("💡 Verify your AWS credentials are set correctly");
    }
  } finally {
    await stagehand.close();
  }
}

// Run the example
runBedrockExample();
