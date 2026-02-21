/**
 * Test Stagehand with Azure OAuth - Library version
 *
 * Usage: npx tsx test-stagehand-oauth-lib.ts
 */
import { Stagehand } from "@browserbasehq/stagehand";
import { setupAzureOAuth } from "./azure-oauth-client";

async function testStagehandWithOAuth() {
  console.log("🎭 Testing Stagehand with Azure OAuth (library mode)...");

  const oauth = await setupAzureOAuth();

  try {
    const stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 1,
      llmClient: oauth.llmClient,
    });

    console.log("🎭 Initializing Stagehand...");
    await stagehand.init();
    console.log("✅ Stagehand initialized!");

    const page = stagehand.context.pages()[0];
    console.log("🌐 Navigating to Google...");
    await page.goto("https://www.google.com");

    console.log("🎯 Testing Stagehand act() method...");
    await stagehand.act("click the search input field");
    console.log("✅ Successfully clicked search input!");

    await stagehand.act("type 'Azure OpenAI Computer Use Agent'");
    console.log("✅ Successfully typed search query!");

    console.log("📊 Testing Stagehand extract() method...");
    const searchButtonText = await stagehand.extract(
      "get the text of the search button"
    );
    console.log("✅ Extracted search button text:", searchButtonText);

    // Test CUA agent (uses the in-process proxy)
    console.log("🤖 Testing Computer Use Agent (CUA)...");
    const agent = stagehand.agent({
      mode: "cua",
      model: oauth.cuaModel,
    });

    console.log("🚀 Running CUA agent...");
    const result = await agent.execute({
      instruction:
        "search google flights for a one-way flight from New York to San Francisco next tuesday and tell me the price of the first result",
      maxSteps: 50,
    });

    console.log("🎉 CUA Agent completed!");
    console.log("📋 Result:", result.message);

    console.log("\n🏆 SUCCESS! Stagehand is working with Azure OAuth!");
    console.log("\n✨ What works:");
    console.log("✅ OAuth authentication (direct library)");
    console.log("✅ Basic Stagehand operations (act, extract)");
    console.log("✅ Computer Use Agent (CUA)");
    console.log("✅ Browser automation");

    await stagehand.close();
  } catch (error: any) {
    console.error("❌ Test failed:", error.message);
    console.error("\n💡 Troubleshooting:");
    console.error("1. Check your Azure CLI authentication (az login)");
    console.error("2. Verify network connectivity to trapi endpoint");
    throw error;
  } finally {
    await oauth.cleanup();
  }
}

testStagehandWithOAuth()
  .then(() => {
    console.log("\n🎊 Test completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Test failed:", error.message);
    process.exit(1);
  });
