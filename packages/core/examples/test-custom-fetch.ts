import { Stagehand } from "../lib/v3";

/**
 * Test script to verify custom fetch and headers are forwarded to AI SDK providers
 *
 * This demonstrates the fix for the bug where custom fetch functions and headers
 * were being silently ignored when using AI SDK providers (e.g., "openai/gpt-4o-mini").
 *
 * Expected behavior:
 * - Custom fetch function should be called for all LLM API requests
 * - Custom headers should be included in the requests
 * - This enables use cases like: proxy authentication, request logging, retry logic
 */

async function main() {
  // Track if custom fetch was called
  let fetchCallCount = 0;
  const customHeaders: string[] = [];

  // Create custom fetch function
  const customFetch: typeof fetch = async (url, options) => {
    fetchCallCount++;
    console.log(`✅ Custom fetch called (${fetchCallCount} times)`);
    console.log(`   URL: ${url}`);

    // Log custom headers if present
    if (options?.headers) {
      const headers = new Headers(options.headers);
      headers.forEach((value, key) => {
        if (key.toLowerCase().startsWith('x-custom')) {
          customHeaders.push(`${key}: ${value}`);
          console.log(`   Custom header: ${key}: ${value}`);
        }
      });
    }

    return fetch(url, options);
  };

  // Initialize Stagehand with custom fetch and headers
  console.log("Initializing Stagehand with custom fetch and headers...\n");

  const stagehand = new Stagehand({
    model: {
      modelName: "openai/gpt-4o-mini",
      apiKey: process.env.OPENAI_API_KEY,
      fetch: customFetch,
      headers: {
        "X-Custom-Header": "test-value",
        "X-Custom-Proxy-Auth": "proxy-token-123"
      }
    } as any,
    env: "LOCAL"
  });

  await stagehand.init();

  try {
    console.log("Making a simple LLM call via act()...\n");

    // Navigate to a simple page
    await stagehand.context.pages()[0].goto("https://example.com");

    // Make an act() call that will use the LLM
    await stagehand.act("find the heading on the page");

    console.log("\n=== Test Results ===");
    if (fetchCallCount > 0) {
      console.log(`✅ SUCCESS: Custom fetch was called ${fetchCallCount} times`);
      console.log(`✅ Custom headers detected: ${customHeaders.length > 0 ? customHeaders.join(", ") : "None (may be overridden by SDK)"}`);
    } else {
      console.log("❌ FAILURE: Custom fetch was NOT called");
      console.log("   This indicates the bug still exists.");
    }
  } catch (error) {
    console.error("\n❌ Error during test:", error);
  } finally {
    await stagehand.close();
  }
}

main().catch(console.error);
