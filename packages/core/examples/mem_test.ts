import { Stagehand } from "../../../dist/index.js";

/**
 * Memory leak test for Stagehand
 *
 * This script repeatedly initializes, uses, and closes Stagehand instances
 * while monitoring memory usage to detect potential memory leaks.
 *
 * Usage:
 *  - npm install @browserbasehq/stagehand @types/node
 *  - ts-node mem_test.ts
 *  - To limit iterations: ts-node mem_test.ts 20 (for 20 iterations)
 *  - For better memory tracking: node --expose-gc -r ts-node/register mem_test.ts
 */

// Setup
const iterations = process.argv[2] ? parseInt(process.argv[2]) : 100;
const delay = 250; // ms between iterations
const memCheckInterval = 5; // Check memory every X iterations
let startHeap: NodeJS.MemoryUsage;

// Memory monitoring
function logMemoryUsage(iteration: number, isStart = false) {
  const used = process.memoryUsage();
  const currentHeap = Math.round(used.heapUsed / 1024 / 1024);
  const totalHeap = Math.round(used.heapTotal / 1024 / 1024);
  const rss = Math.round(used.rss / 1024 / 1024);

  if (isStart) {
    startHeap = used;
    console.log(
      `🧠 INITIAL MEMORY: heap=${currentHeap}MB total=${totalHeap}MB rss=${rss}MB`,
    );
    return;
  }

  const startHeapMB = Math.round(startHeap.heapUsed / 1024 / 1024);
  const startRssMB = Math.round(startHeap.rss / 1024 / 1024);
  const diffMB = currentHeap - startHeapMB;
  const diffRssMB = rss - startRssMB;
  const diffPercent = Math.round((diffMB / startHeapMB) * 100);
  const diffRssPercent = Math.round((diffRssMB / startRssMB) * 100);

  console.log(`🧠 ITERATION ${iteration}/${iterations}:`);
  console.log(
    `   heap=${currentHeap}MB (${diffMB > 0 ? "+" : ""}${diffMB}MB | ${diffPercent}%)`,
  );
  console.log(
    `   rss=${rss}MB (${diffRssMB > 0 ? "+" : ""}${diffRssMB}MB | ${diffRssPercent}%)`,
  );
  console.log(`   total=${totalHeap}MB`);

  // Force garbage collection if available (requires --expose-gc when running node)
  if (global.gc) {
    global.gc();
    console.log("🧹 Garbage collection forced");
  }
}
// Sleep helper
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Main test function
async function runTest() {
  console.log(`🔄 Starting Stagehand memory test (${iterations} iterations)`);
  console.log("⚠️  Run with node --expose-gc for better memory tracking");

  logMemoryUsage(0, true);

  for (let i = 1; i <= iterations; i++) {
    console.log(`\n📦 Iteration ${i}/${iterations}`);

    try {
      // Create a new Stagehand instance
      console.log("   Creating Stagehand...");
      const sh = new Stagehand({
        env: "BROWSERBASE",
        modelName: "gemini-2.0-flash",
        modelClientOptions: {
          apiKey: "AIzaSyCRkN_GWiEjNjjckBpI97oR_vwZb3nNE1o",
        },
        projectId: "fe1911a7-7576-4cf9-b2ab-e1d9c7dc277b",
        apiKey: "bb_live_SuxuDVZQhZDWiqdBdu8uM24GJjI",
        // disablePino: true,
        // useAPI: true,
      });
      // const sh = new Stagehand({
      //   env: "LOCAL",
      //   // localBrowserLaunchOptions: { headless: true },
      // });
      // Initialize it
      console.log("   Initializing...");
      await sh.init();

      // Use it
      // console.log("   Navigating to example.com...");
      await sh.page.goto("https://example.com");
      // await sh.page.screenshot();
      // console.log("   Observing...");
      // const result = await sh.page.observe("find the first button/link");
      // console.log("   Acting...");
      // if (result.length > 0) {
      //   await sh.page.act(result[0]);
      // }

      // Close it
      // console.log("   Closing Stagehand...");
      await sh.close();

      console.log("✅ Iteration complete");
    } catch (error) {
      console.error(`❌ Error in iteration ${i}:`, error);
    }

    // Log memory usage every X iterations
    if (i % memCheckInterval === 0) {
      logMemoryUsage(i);
    }

    // Small delay between iterations
    await sleep(delay);
  }
  await sleep(60000);
  // Final memory check
  logMemoryUsage(iterations);
  console.log("\n✅ Memory test complete!");
}

// Run the test
runTest().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
