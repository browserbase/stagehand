import { Stagehand } from "@browserbasehq/stagehand";
import { performance } from "perf_hooks"; // Using Node.js perf_hooks for more precise timing

async function main() {
  console.log("Initializing Stagehand for performance test...");

  // Ensure StagehandConfig is correctly picking up necessary configurations
  // (e.g., API keys for @stagehand-api)
  const stagehand = new Stagehand({
    // env: "LOCAL",
    env: "BROWSERBASE",
    verbose: 2,
    // modelName:"claude-3-5-sonnet-latest",
    // modelName: "gpt-4o-mini",
    // modelName: "google/gemini-2.5-flash-preview-05-20",
    modelName: "google/gemini-2.0-flash",
    // modelName: "gemini-2.0-flash",
    // modelName: "openai/gpt-4.1-mini",
    // modelName: "claude-3-7-sonnet-latest",
    // modelClientOptions: {
    //   apiKey: process.env.OPENAI_API_KEY,
    // },
    // browserbaseSessionID: "1a3f9a62-43e1-4da1-8a96-83c5d840e1af",
    // browserbaseSessionID: "e51f8135-70d6-41c1-9578-d566d92178a1",
    browserbaseSessionCreateParams: {
      proxies: true,
      projectId: process.env.BROWSERBASE_PROJECT_ID,
      browserSettings: {
        blockAds: true,
        // 'advancedStealth': true,
      },
    },
    useAPI: true,
    // browserbaseSessionID: "801b4e55-ee97-439e-8d3e-35d94f9121f3",
    // llmClient: new AISdkClient({
    //   model: google("gemini-2.0-flash-001"),
    //   }),
    // localBrowserLaunchOptions: {
    //   viewport: {
    //     width: 1024,
    //     height: 768,
    //   },
    // },
  });
  const initialTime = performance.now();

  await stagehand.init();
  const page = stagehand.page;

  const testUrl = "https://example.com";
  const instructionToObserve = "Get the main heading of this page";
  const numberOfCalls = 50; // Number of times to repeat the observe call

  console.log(`Starting performance test: Navigating to ${testUrl}`);
  await page.goto(testUrl, { waitUntil: "domcontentloaded" });

  console.log(
    `Performing ${numberOfCalls} observe calls for instruction: "${instructionToObserve}"`,
  );

  const callTimings: number[] = [];

  for (let i = 0; i < numberOfCalls; i++) {
    const startTime = performance.now();
    try {
      console.log(`  Call ${i + 1}/${numberOfCalls}: Observing... `);
      const observeResults = await page.observe({
        instruction: instructionToObserve,
        returnAction: true, // Keep this as per typical usage, though we don't act here
      });

      if (observeResults.length > 0) {
        // console.log(`    Observed result for call ${i + 1}: `, observeResults[0]);
        // For this performance test, we are primarily interested in the observe call's speed.
        // No action is taken with the result to keep the measurement focused.
      } else {
        console.warn(
          `    Warning: Call ${i + 1} returned no observation results.`,
        );
      }
    } catch (error) {
      console.error(`    Error during observe call ${i + 1}: `, error);
      // Decide if you want to stop the test or continue
      // For now, we'll log the error and push a -1 time or skip
      callTimings.push(-1); // Indicate error or skip timing this iteration
      continue;
    }
    const endTime = performance.now();
    const duration = endTime - startTime;
    callTimings.push(duration);
    console.log(`    Call ${i + 1} completed in ${duration.toFixed(2)} ms`);
  }

  console.log("\n--- Performance Test Results ---");
  let totalTime = 0;
  let successfulCalls = 0;
  callTimings.forEach((time, index) => {
    if (time >= 0) {
      console.log(`Call ${index + 1}: ${time.toFixed(2)} ms`);
      totalTime += time;
      successfulCalls++;
    } else {
      console.log(`Call ${index + 1}: Errored`);
    }
  });

  if (successfulCalls > 0) {
    const averageTime = totalTime / successfulCalls;
    console.log(
      `\nTotal time for ${successfulCalls} successful calls: ${totalTime.toFixed(2)} ms`,
    );
    console.log(
      `Average time per successful call: ${averageTime.toFixed(2)} ms`,
    );
  } else {
    console.log("No successful calls were made.");
  }

  console.log("\nClosing Stagehand...");
  await stagehand.close();
  console.log("Performance test finished.");
  const finalTime = performance.now();
  console.log(
    `Total time taken: ${((finalTime - initialTime) / 1000).toFixed(2)} seconds`,
  );
}

main().catch((error) => {
  console.error("Unhandled error in main performance test function:", error);
  process.exit(1);
});
