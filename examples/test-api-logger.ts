import { Stagehand } from "../lib/index";
import { createStagehandApiLogger } from "../lib/stagehandApiLogger";

async function testApiLogger() {
  console.log("Starting test with custom sh:api logger...\n");

  const stagehand = new Stagehand({
    logger: createStagehandApiLogger(),
    headless: false,
  });

  try {
    await stagehand.init();
    const page = stagehand.page;

    console.log("\nNavigating to example.com...");
    await page.goto("https://example.com");

    console.log("\nExtracting page title...");
    const title = await stagehand.extract({
      instruction: "Extract the main heading of the page",
    });
    console.log("Extracted title:", title);

    console.log("\nPerforming a simple action...");
    await stagehand.act({
      action: "click on the 'More information' link",
    });

    console.log("\nObserving the page...");
    const observation = await stagehand.observe();
    console.log("Observation result:", observation);
  } catch (error) {
    console.error("Error during test:", error);
  } finally {
    await stagehand.close();
  }
}

// Run the test
testApiLogger().catch(console.error);
