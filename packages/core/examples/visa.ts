import "dotenv/config";
import { Stagehand } from "@browserbasehq/stagehand";

// Allow self-signed certificates for internal APIs if needed
if (process.env.LLM_BASE_URL && process.env.LLM_BASE_URL.includes("visa.com")) {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  console.log("⚠️ SSL verification disabled for internal Visa API");
}

/**
 * Stagehand V3 with Native Model Configuration
 * Uses Stagehand's built-in model support instead of custom LLM client
 */
async function automateSupplierForm() {
  console.log("\n" + "=".repeat(70));
  console.log("🤖 Stagehand V3 - Native Model Configuration Test");
  console.log("=".repeat(70) + "\n");

  // Configuration
  const targetURL = "https://supplier-payment-por-9ku7.bolt.host";
  const supplierName = "TestSupplier";
  const supplierEmail = "TestSupplier@gmail.com";

  console.log("📋 Configuration:");
  console.log(` Target URL: ${targetURL}`);
  console.log(` Supplier Name: ${supplierName}`);
  console.log(` Supplier Email: ${supplierEmail}`);
  console.log(` Model: ${process.env.LLM_MODEL_NAME}\n`);

  console.log("🚀 Initializing Stagehand V3 with native model config...");

  // For custom baseURL, we must use "openai/" provider
  // because only OpenAI provider supports custom baseURL in AI SDK
  let modelName = process.env.LLM_MODEL_NAME || "gemini-2.5-flash";

  // Remove any provider prefix
  modelName = modelName.replace(/^(google|openai|anthropic)\//, "");

  // Always use openai/ prefix for custom endpoints
  // The actual model name (gemini-2.5-flash) is passed to your endpoint
  modelName = `google/${modelName}`;

  console.log(` Using provider: openai (for custom endpoint)`);
  console.log(` Model name: ${modelName.replace("openai/", "")}`);
  console.log(` Custom endpoint: ${process.env.LLM_BASE_URL}\n`);

  // Initialize Stagehand with native model configuration
  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 2,
    localBrowserLaunchOptions: {
      headless: false,
    },
    // Use OpenAI provider format for custom baseURL support
    model: {
      modelName: modelName,
      apiKey: process.env.LLM_API_KEY,
      baseURL: process.env.LLM_BASE_URL,
    },
    // disableAPI: true,
  });

  await stagehand.init();
  console.log("✅ Stagehand V3 initialized\n");

  // V3 API: Access page via context
  const page = stagehand.context.pages()[0];

  if (!page) {
    throw new Error("No page available");
  }

  try {
    // Step 1: Navigate
    console.log("━".repeat(70));
    console.log("📍 [Step 1] Navigating to supplier form...");
    console.log("━".repeat(70));
    await page.goto(targetURL, { waitUntil: "networkidle" });
    console.log("✅ Page loaded successfully\n");

    await new Promise((resolve) => setTimeout(resolve, 3000));
    console.log("✅ Page loaded and ready\n");

    // Step 2: Fill form using Observe + Act Pattern
    console.log("━".repeat(70));
    console.log("✍️ [Step 2] Filling form using Observe + Act pattern...");
    console.log("━".repeat(70) + "\n");

    // Observe supplier name field
    console.log("🔍 [1/3] Observing supplier name field...");
    const nameActions = await stagehand.observe(
      "find the supplier name input field and the supplier email field",
      { timeout: 60000 },
    );

    console.log(` ✓ Found ${nameActions.length} actions for name field`);

    if (nameActions.length === 0) {
      throw new Error("No supplier name field found by observe()");
    }

    const userNameAction = nameActions[0];
    console.log(` → Action: ${userNameAction.description}`);
    console.log(` → Method: ${userNameAction.method}`);
    userNameAction.arguments = [supplierName];
    const userEmailAction = nameActions[1];
    console.log(` → Action: ${userEmailAction.description}`);
    console.log(` → Method: ${userEmailAction.method}`);
    userEmailAction.arguments = [supplierEmail];

    // Execute with the value
    console.log(` → Filling with: ${supplierName}`);
    for (const action of nameActions) {
      await stagehand.act({
        ...action,
        method: "fill",
      });
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(` ✓ Supplier Email filled successfully\n`);

    console.log("━".repeat(70));
    console.log("🎉 SUCCESS! Form automation completed");
    console.log("━".repeat(70));
    console.log("\n📊 Summary:");
    console.log(` ✓ Supplier Name: ${supplierName}`);
    console.log(` ✓ Supplier Email: ${supplierEmail}\n`);

    console.log(
      "🔍 Browser will remain open for 15 seconds for inspection...\n",
    );
    await new Promise((resolve) => setTimeout(resolve, 15000));
  } catch (error: unknown) {
    console.error("\n" + "━".repeat(70));
    console.error("❌ AUTOMATION FAILED");
    console.error("━".repeat(70));
    console.error(
      `Error: ${error instanceof Error ? error.message : String(error)}`,
    );

    if (error instanceof Error && error.stack) {
      console.error("\nStack trace:");
      console.error(error instanceof Error ? error.stack : String(error));
    }

    console.log(
      "\n⚠️ Browser will remain open for 30 seconds for debugging...",
    );
    await new Promise((resolve) => setTimeout(resolve, 30000));
  } finally {
    console.log("🔚 Closing browser...");
    await stagehand.close();
    console.log("✅ Browser closed. Automation complete.\n");
  }
}

// Entry point
console.log("Starting Stagehand V3 Native Model Test...\n");
automateSupplierForm().catch((error) => {
  console.error("\n💥 Unhandled error:", error);
  process.exit(1);
});

export { automateSupplierForm };
