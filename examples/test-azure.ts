import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "@/stagehand.config";
import { z } from "zod/v3";

/**
 * Test Azure OpenAI integration with Stagehand
 *
 * Prerequisites:
 * - Set AZURE_API_KEY for your Azure OpenAI resource
 * - Set AZURE_OPENAI_ENDPOINT (e.g., https://your-resource.openai.azure.com)
 * - Set AZURE_DEPLOYMENT_NAME for your deployment (e.g., gpt-4)
 * - Optionally set AZURE_RESOURCE_NAME (extracted from endpoint)
 */

async function testAzureOpenAI() {
  console.log("=== Azure OpenAI Integration Test ===");

  // Check for required environment variables
  const deploymentName = process.env.AZURE_DEPLOYMENT_NAME;
  const apiKey = process.env.AZURE_API_KEY;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;

  if (!deploymentName) {
    console.error(
      "❌ AZURE_DEPLOYMENT_NAME not set. Please set it to your Azure OpenAI deployment name.",
    );
    process.exit(1);
  }

  if (!apiKey && !process.env.AZURE_CLIENT_ID) {
    console.error(
      "❌ AZURE_API_KEY not set. Please set it to your Azure OpenAI API key.",
    );
    process.exit(1);
  }

  console.log("Testing Azure OpenAI with deployment:", deploymentName);
  console.log("Endpoint:", endpoint || "Using default");

  // Extract resource name from endpoint if available
  let resourceName = process.env.AZURE_RESOURCE_NAME;
  if (!resourceName && endpoint) {
    const match = endpoint.match(/https:\/\/(.+?)\.openai\.azure\.com/);
    if (match) {
      resourceName = match[1];
    }
  }

  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    modelName: `azure/${deploymentName}`,
    modelClientOptions: {
      apiKey: apiKey,
      resourceName: resourceName,
      apiVersion: "2024-10-21", // Latest stable version
      // Alternative: use the full endpoint
      ...(endpoint && !resourceName ? { baseURL: endpoint } : {}),
    },
  });

  try {
    await stagehand.init();
    const page = stagehand.page;

    // Test 1: Navigation and extraction
    console.log("\n1. Testing navigation and extraction...");
    await page.goto("https://github.com/browserbase/stagehand");

    const { description, language } = await page.extract({
      instruction:
        "Extract the repository description and main programming language",
      schema: z.object({
        description: z.string().describe("Repository description"),
        language: z.string().describe("Main programming language"),
      }),
    });

    console.log("Repository info:", { description, language });

    // Test 2: Observation
    console.log("\n2. Testing observation...");
    const elements = await page.observe("Find the star button");
    console.log("Found elements:", elements.length);

    // Test 3: Action
    console.log("\n3. Testing action...");
    await page.act("click on the README section if visible");

    await stagehand.close();
    console.log("\n✅ Azure OpenAI test completed successfully!");
  } catch (error) {
    console.error("❌ Test failed:", error);
    await stagehand.close();
    process.exit(1);
  }
}

// Alternative: Using Azure AD authentication (requires additional setup)
async function testAzureWithAAD() {
  console.log("\n=== Azure OpenAI with Azure AD Authentication ===");

  // Check if Azure AD credentials are available
  if (!process.env.AZURE_CLIENT_ID || !process.env.AZURE_TENANT_ID) {
    console.log(
      "Skipping Azure AD test - AZURE_CLIENT_ID or AZURE_TENANT_ID not set",
    );
    return;
  }

  try {
    // This requires @azure/identity package
    // npm install @azure/identity
    const { DefaultAzureCredential, getBearerTokenProvider } = await import(
      "@azure/identity"
    );

    const credential = new DefaultAzureCredential();
    const scope = "https://cognitiveservices.azure.com/.default";
    const azureADTokenProvider = getBearerTokenProvider(credential, scope);

    const deploymentName = process.env.AZURE_DEPLOYMENT_NAME || "gpt-4";
    const resourceName = process.env.AZURE_RESOURCE_NAME;

    if (!resourceName) {
      console.error(
        "❌ AZURE_RESOURCE_NAME is required for Azure AD authentication",
      );
      return;
    }

    console.log(
      "Using Azure AD authentication with deployment:",
      deploymentName,
    );

    const stagehand = new Stagehand({
      ...StagehandConfig,
      env: "LOCAL",
      verbose: 1,
      modelName: `azure/${deploymentName}`,
      modelClientOptions: {
        azureADTokenProvider,
        resourceName: resourceName,
        apiVersion: "2024-10-21",
      },
    });

    await stagehand.init();
    const page = stagehand.page;

    await page.goto("https://example.com");

    const { text } = await page.extract({
      instruction: "Extract the main text content",
      schema: z.object({
        text: z.string().describe("Main text content"),
      }),
    });

    console.log("Extracted text:", text);

    await stagehand.close();
    console.log("✅ Azure AD authentication test completed successfully!");
  } catch (error) {
    if (error.message?.includes("Cannot find module '@azure/identity'")) {
      console.log(
        "ℹ️ @azure/identity not installed. Install it to use Azure AD authentication:",
      );
      console.log("  npm install @azure/identity");
    } else {
      console.error("❌ Azure AD test failed:", error);
    }
  }
}

async function testAzureWithSimplePage() {
  const deploymentName = process.env.AZURE_DEPLOYMENT_NAME;
  const apiKey = process.env.AZURE_API_KEY;

  if (!deploymentName || !apiKey) {
    console.log("Skipping simple page test - missing configuration");
    return;
  }

  console.log("\n4. Testing with a simple page...");

  const resourceName = process.env.AZURE_RESOURCE_NAME;
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;

  const stagehand = new Stagehand({
    ...StagehandConfig,
    env: "LOCAL",
    verbose: 1,
    modelName: `azure/${deploymentName}`,
    modelClientOptions: {
      apiKey: apiKey,
      ...(resourceName ? { resourceName } : {}),
      ...(endpoint && !resourceName ? { baseURL: endpoint } : {}),
      apiVersion: "2024-10-21",
    },
  });

  try {
    await stagehand.init();
    const page = stagehand.page;

    await page.goto("https://example.com");

    // Simple extraction
    const { domain } = await page.extract({
      instruction: "What is the domain name shown on this page?",
      schema: z.object({
        domain: z.string().describe("The domain name"),
      }),
    });

    console.log("Domain found:", domain);

    // Try clicking
    await page.act("click on More information");
    console.log("Action completed, current URL:", page.url());

    await stagehand.close();
    console.log("✅ Simple page test completed successfully!");
  } catch (error) {
    console.error("❌ Simple page test failed:", error);
    await stagehand.close();
  }
}

// Run tests
(async () => {
  try {
    // Run main Azure OpenAI test
    await testAzureOpenAI();

    // Run simple page test
    await testAzureWithSimplePage();

    // Optionally run Azure AD test if configured
    await testAzureWithAAD();

    console.log("\n🎉 All Azure tests completed!");
  } catch (error) {
    console.error("Test suite failed:", error);
    process.exit(1);
  }
})();
