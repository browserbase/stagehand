import { Stagehand } from "@browserbasehq/stagehand";

/**
 * AWS Bedrock Integration Test for Stagehand
 *
 * This test demonstrates AWS Bedrock integration using bearer token authentication.
 *
 * NOTE: This test focuses on basic functionality as OpenAI models in Bedrock
 * work best for navigation and simple operations. For advanced features like
 * structured extraction and observation, consider using Anthropic models.
 *
 * SETUP INSTRUCTIONS:
 *
 * 1. GET AWS BEDROCK API KEY:
 *    - Go to AWS Bedrock Console: https://console.aws.amazon.com/bedrock/
 *    - Navigate to "Model access" in the left sidebar
 *    - Click "Enable model access"
 *    - Enable access for desired models (e.g., Anthropic Claude, OpenAI models)
 *    - Wait for approval (can take minutes to hours)
 *
 * 2. GENERATE BEARER TOKEN:
 *    - In AWS Bedrock Console, go to "API keys" section
 *    - Create a new API key
 *    - Copy the bearer token (starts with "bedrock-api-key-")
 *
 * 3. SET ENVIRONMENT VARIABLES:
 *    Create a .env file with:
 *    ```
 *    AWS_BEARER_TOKEN_BEDROCK=bedrock-api-key-[your-base64-token]
 *    AWS_REGION=us-east-1
 *    AWS_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0
 *    ```
 *
 * 4. ALTERNATIVE - STANDARD AWS CREDENTIALS:
 *    If you prefer standard AWS credentials instead of bearer token:
 *    ```
 *    AWS_ACCESS_KEY_ID=your-access-key
 *    AWS_SECRET_ACCESS_KEY=your-secret-key
 *    AWS_REGION=us-east-1
 *    AWS_MODEL_ID=anthropic.claude-3-haiku-20240307-v1:0
 *    ```
 *
 * SUPPORTED MODEL IDs:
 * - anthropic.claude-3-haiku-20240307-v1:0 (recommended for extract/observe)
 * - anthropic.claude-3-5-sonnet-20240620-v1:0 (recommended for extract/observe)
 * - openai.gpt-oss-120b-1:0 (works well for act/observe, may need adjustments for extract)
 * - See AWS Bedrock Console for full list of available models
 */

async function testBedrockIntegration() {
  // Use model ID from environment or default to OpenAI GPT-OSS-120B
  const modelId = process.env.AWS_MODEL_ID || "openai.gpt-oss-120b-1:0";

  console.log("🧪 AWS Bedrock Integration Test");
  console.log(`📋 Model: ${modelId}`);
  console.log(`🌍 Region: ${process.env.AWS_REGION || "us-east-1"}`);

  // Check authentication setup
  // const hasBearer = !!process.env.AWS_BEARER_TOKEN_BEDROCK;
  // const hasStandard = !!(
  //   process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
  // );

  // if (!hasBearer && !hasStandard) {
  //   console.error("❌ No AWS authentication found!");
  //   console.error(
  //     "💡 Set either AWS_BEARER_TOKEN_BEDROCK or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY",
  //   );
  //   process.exit(1);
  // }

  // console.log(`🔐 Auth: ${hasBearer ? "Bearer Token" : "AWS Credentials"}`);

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 2, // Maximum verbosity to see all LLM details
    modelName: `bedrock/${modelId}`,
  });

  try {
    await stagehand.init();
    const page = stagehand.page;

    console.log("✅ Stagehand initialized successfully");

    // Test 1: Navigation
    console.log("\n🌐 Test 1: Navigation");
    await page.goto("https://example.com");
    console.log("✅ Navigation successful");

    // Test 2: Page interaction with clicking (with retries for OpenAI model)
    console.log("\n🎯 Test 2: Page Interaction with Retries");

    let success = false;
    let lastError: Error | null = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(
          `🔄 Attempt ${attempt}/${maxRetries}: Trying page.act("click the link")`,
        );
        await page.act("click the link");
        console.log(
          `✅ Click successful on attempt ${attempt} - URL: ${page.url()}`,
        );
        success = true;
        break;
      } catch (error) {
        lastError = error as Error;
        console.log(
          `⚠️ Attempt ${attempt} failed: ${error.message.split("\n")[0]}`,
        );

        if (attempt < maxRetries) {
          console.log(`🔄 Retrying in 1 second...`);
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }
    }

    if (!success) {
      console.log(
        `❌ All ${maxRetries} attempts failed. Last error: ${lastError?.message}`,
      );
      throw lastError;
    }

    await stagehand.close();

    console.log(
      "\n🎉 AWS Bedrock integration with OpenAI model is working perfectly!",
    );
  } catch (error) {
    console.error("\n❌ Test failed:", error.message);

    // Provide helpful error guidance
    if (error.message?.includes("You don't have access")) {
      console.error("💡 Enable model access in AWS Bedrock Console:");
      console.error("   https://console.aws.amazon.com/bedrock/");
    } else if (
      error.message?.includes("credentials") ||
      error.message?.includes("authentication")
    ) {
      console.error("💡 Check your AWS credentials in .env file");
    }

    await stagehand.close();
    process.exit(1);
  }
}

// Run the test
testBedrockIntegration();
