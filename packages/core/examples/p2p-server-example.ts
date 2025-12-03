/**
 * Example: Running Stagehand as a P2P Server
 *
 * This example demonstrates how to run Stagehand as an HTTP server
 * that other Stagehand instances can connect to and execute commands remotely.
 *
 * Usage:
 *   npx tsx examples/p2p-server-example.ts
 */

import { Stagehand } from "../dist/index.js";

async function main() {
  console.log("Starting Stagehand P2P Server...");

  // Check if we should use BROWSERBASE or LOCAL
  const useBrowserbase =
    process.env.BROWSERBASE_API_KEY && process.env.BROWSERBASE_PROJECT_ID;

  // Create a Stagehand instance
  const stagehand = new Stagehand(
    useBrowserbase
      ? {
          env: "BROWSERBASE",
          apiKey: process.env.BROWSERBASE_API_KEY,
          projectId: process.env.BROWSERBASE_PROJECT_ID,
          verbose: 1,
        }
      : {
          env: "LOCAL",
          verbose: 1,
          localBrowserLaunchOptions: {
            headless: false, // Set to false to see the browser
          },
        }
  );

  console.log(
    `Initializing browser (${useBrowserbase ? "BROWSERBASE" : "LOCAL"})...`
  );
  await stagehand.init();
  console.log("✓ Browser initialized");

  // Create and start the server
  console.log("Creating server...");
  const server = stagehand.createServer({
    port: 3000,
    host: "127.0.0.1", // Use localhost for testing
  });

  await server.listen();
  console.log(`✓ Server listening at ${server.getUrl()}`);
  console.log(`  Active sessions: ${server.getActiveSessionCount()}`);

  // Navigate to a starting page
  console.log("\nNavigating to google.com...");
  const page = await stagehand.context.awaitActivePage();
  await page.goto("https://google.com");
  console.log("✓ Page loaded");

  // The server can also use Stagehand locally while serving remote requests
  console.log("\nTesting local execution...");
  const result = await stagehand.act("scroll down");
  console.log("✓ Local action completed:", result.success ? "success" : "failed");

  // Keep the server running
  console.log("\n" + "=".repeat(60));
  console.log("Server is ready!");
  console.log("=".repeat(60));
  console.log("\nTo connect from another terminal, run:");
  console.log("  npx tsx examples/p2p-client-example.ts");
  console.log("\nOr from code:");
  console.log("  // In your client process:");
  console.log(`  process.env.STAGEHAND_API_URL = '${server.getUrl()}/v1';`);
  console.log(
    "  const stagehand = new Stagehand({ env: 'LOCAL', verbose: 1 });",
  );
  console.log("  await stagehand.init();");
  console.log("\nPress Ctrl+C to stop the server");
  console.log("=".repeat(60));

  // Handle graceful shutdown
  process.on("SIGINT", async () => {
    console.log("\n\nShutting down gracefully...");
    try {
      await server.close();
      await stagehand.close();
      console.log("✓ Server closed");
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  });

  // Keep the process alive
  await new Promise(() => {});
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
