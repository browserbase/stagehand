const { Stagehand } = require("@browserbasehq/stagehand");

/**
 * Simple Stagehand test using the OAuth proxy
 */
async function testStagehandWithOAuth() {
  console.log("🎭 Testing Stagehand with OAuth proxy...");

  // First verify the proxy is running
  try {
    const response = await fetch("http://localhost:3001/health");
    const health = await response.json();
    console.log("✅ Proxy health check:", health.status);
    console.log("📡 Endpoint:", health.endpoint); 
    console.log("🤖 Deployment:", health.deployment);
  } catch (error) {
    console.error("❌ Proxy server not running!");
    console.error("💡 Start it first: node oauth-proxy-server.js");
    process.exit(1);
  }

  try {
    // Configure Stagehand to use our OAuth proxy
    const stagehand = new Stagehand({
      env: "LOCAL",  
      verbose: 1,
      model: {
        modelName: "openai/gpt-4o",  // Stagehand recognizes this format
        apiKey: "oauth-dummy",       // Dummy - proxy handles real auth
        baseURL: "http://localhost:3001/v1"  // Point to our OAuth proxy
      }
    });

    console.log("🎭 Initializing Stagehand...");
    await stagehand.init();
    console.log("✅ Stagehand initialized!");

    // Test basic functionality
    const page = stagehand.context.pages()[0];
    console.log("🌐 Navigating to Google...");
    await page.goto("https://www.google.com");

    console.log("🎯 Testing Stagehand act() method...");
    await stagehand.act("click the search input field");
    console.log("✅ Successfully clicked search input!");

    await stagehand.act("type 'Azure OpenAI Computer Use Agent'");
    console.log("✅ Successfully typed search query!");

    // Test extraction
    console.log("📊 Testing Stagehand extract() method...");
    const searchButtonText = await stagehand.extract("get the text of the search button");
    console.log("✅ Extracted search button text:", searchButtonText);

    // Test CUA agent
    console.log("🤖 Testing Computer Use Agent (CUA)...");
    const agent = stagehand.agent({
      mode: "cua",
      model: {
        modelName: "openai/computer-use-preview",
        apiKey: "oauth-dummy",
        baseURL: "http://localhost:3001/v1"
      }
    });

    console.log("🚀 Running CUA agent...");
    // const result = await agent.execute({
    //   instruction: "Press Enter to search and tell me about the first search result",
    //   maxSteps: 5  // Keep it simple for testing
    // });

    const result = await agent.execute({
       instruction: "search google flights for a one-way flight from New York to San Francisco next tuesday and tell me the price of the first result",
       maxSteps: 50  // Keep it simple for testing
     });

    console.log("🎉 CUA Agent completed!");
    console.log("📋 Result:", result.message);

    console.log("\n🏆 SUCCESS! Stagehand is working with your OAuth setup!");
    console.log("\n✨ What works:");
    console.log("✅ OAuth authentication");
    console.log("✅ Basic Stagehand operations (act, extract)"); 
    console.log("✅ Computer Use Agent (CUA)");
    console.log("✅ Browser automation");

  } catch (error) {
    console.error("❌ Test failed:", error.message);
    console.error("\n💡 Troubleshooting:");
    console.error("1. Make sure the proxy server is running");
    console.error("2. Check your Azure CLI authentication");  
    console.error("3. Verify network connectivity");
    throw error;
  }
}

module.exports = { testStagehandWithOAuth };

// Run if executed directly
if (require.main === module) {
  testStagehandWithOAuth()
    .then(() => {
      console.log("\n🎊 Test completed successfully!");
      process.exit(0);
    })
    .catch(error => {
      console.error("\n💥 Test failed:", error.message);
      process.exit(1);
    });
}