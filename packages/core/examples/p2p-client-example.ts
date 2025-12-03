/**
 * Example: Connecting to a Remote Stagehand Server
 *
 * This example demonstrates how to connect to a remote Stagehand server
 * and execute commands that run on the remote machine.
 *
 * Usage:
 *   1. First, start the server in another terminal:
 *      npx tsx examples/p2p-server-example.ts
 *
 *   2. Then run this client:
 *      npx tsx examples/p2p-client-example.ts
 */

import { Stagehand } from "../dist/index.js";
import { z } from "zod/v3";

async function main() {
  const SERVER_URL = process.env.STAGEHAND_SERVER_URL || "http://localhost:3000";

  console.log("Stagehand P2P Client");
  console.log("=".repeat(60));
  console.log(`Connecting to server at ${SERVER_URL}...`);

  // When STAGEHAND_API_URL is set to the P2P server URL
  // (e.g. "http://localhost:3000/v1"), Stagehand will use the HTTP API
  // instead of launching a local browser.
  if (!process.env.STAGEHAND_API_URL) {
    process.env.STAGEHAND_API_URL = `${SERVER_URL}/v1`;
  }

  const stagehand = new Stagehand({
    env: "BROWSERBASE",
    verbose: 1,
  });

  await stagehand.init();
  console.log("✓ Connected to remote server\n");

  // Navigate to a test page first
  console.log("=".repeat(60));
  console.log("Navigating to example.com");
  console.log("=".repeat(60));
  try {
    // Navigate using the remote API
    await stagehand.goto("https://example.com");
    console.log("✓ Navigated to example.com\n");
  } catch (error: any) {
    console.error("✗ Navigation error:", error.message);
  }

  // All actions now execute on the remote machine
  console.log("=".repeat(60));
  console.log("Testing act()");
  console.log("=".repeat(60));
  try {
    const actResult = await stagehand.act("scroll to the bottom");
    console.log("✓ Act result:", {
      success: actResult.success,
      message: actResult.message,
      actionsCount: actResult.actions.length,
    });
  } catch (error: any) {
    console.error("✗ Act error:", error.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Testing extract()");
  console.log("=".repeat(60));
  try {
    const extractResult = await stagehand.extract("extract the page title");
    console.log("✓ Extract result:", extractResult);
  } catch (error: any) {
    console.error("✗ Extract error:", error.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Testing observe()");
  console.log("=".repeat(60));
  try {
    const observeResult = await stagehand.observe("find all links on the page");
    console.log(
      `✓ Observe result: Found ${observeResult.length} actions`
    );
    if (observeResult.length > 0) {
      console.log("  First action:", {
        selector: observeResult[0].selector,
        description: observeResult[0].description,
      });
    }
  } catch (error: any) {
    console.error("✗ Observe error:", error.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("Testing extract with schema");
  console.log("=".repeat(60));
  try {
    const schema = z.object({
      title: z.string(),
      heading: z.string().optional(),
    });
    const structuredData = await stagehand.extract(
      "extract the page title and main heading",
      schema
    );
    console.log("✓ Structured data:", structuredData);
  } catch (error: any) {
    console.error("✗ Structured extract error:", error.message);
  }

  console.log("\n" + "=".repeat(60));
  console.log("All tests completed!");
  console.log("=".repeat(60));
  console.log("\nNote: The browser is running on the remote server.");
  console.log("      All commands were executed via RPC over HTTP/SSE.\n");
}

main().catch((error) => {
  console.error("\n❌ Fatal error:", error);
  process.exit(1);
});
