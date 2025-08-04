import { Stagehand } from "../lib/index";
import { z } from "zod";

async function main() {
  console.log("Starting Context Manager example...");

  // Initialize Stagehand (ContextManager is now always enabled by default)
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    localBrowserLaunchOptions: {
      headless: false,
    },
  });

  try {
    await stagehand.init();
    console.log(
      "✅ Stagehand initialized with ContextManager (enabled by default)",
    );

    // ContextManager is always available now
    console.log("✅ ContextManager is available and ready");

    // Navigate to a test page
    await stagehand.page.goto("https://example.com");
    console.log("📄 Navigated to example.com");

    // Example 1: Using act with context manager
    console.log("\n🎯 Testing act with ContextManager...");
    try {
      // The act handler will now use the context manager if available
      await stagehand.page.act({ action: "scroll down" });
      console.log("✅ Act completed successfully with ContextManager");
    } catch (error) {
      console.log("❌ Act failed:", error);
    }

    // Example 2: Using observe with context manager
    console.log("\n👀 Testing observe with ContextManager...");
    try {
      const observations = await stagehand.page.observe({
        instruction: "find all links on this page",
      });
      console.log(
        `✅ Observe completed: found ${observations.length} elements`,
      );
    } catch (error) {
      console.log("❌ Observe failed:", error);
    }

    // Example 3: Using extract with context manager
    console.log("\n📊 Testing extract with ContextManager...");
    try {
      const data = await stagehand.page.extract({
        instruction: "extract the page title and description",
        schema: z.object({
          title: z.string(),
          description: z.string().optional(),
        }),
      });
      console.log("✅ Extract completed:", data);
    } catch (error) {
      console.log("❌ Extract failed:", error);
    }

    // Example 4: Direct context manager usage
    console.log("\n🔧 Testing direct ContextManager usage...");
    try {
      const contextResult = await stagehand.contextManager!.buildContext({
        method: "extract",
        instruction: "find contact information",
        takeScreenshot: false,
        includeAccessibilityTree: true,
        domElements: "<div>Sample DOM</div>",
        appendToHistory: false,
      });

      console.log("✅ Context optimization completed");
      console.log("   - Messages count:", contextResult.allMessages.length);
      console.log(
        "   - Has optimized elements:",
        !!contextResult.optimizedElements,
      );
    } catch (error) {
      console.log("❌ Direct context manager usage failed:", error);
    }

    console.log("\n🎉 All ContextManager tests completed!");
  } catch (error) {
    console.error("❌ Error during execution:", error);
  } finally {
    await stagehand.close();
    console.log("🔚 Stagehand closed");
  }
}

if (require.main === module) {
  main().catch(console.error);
}

export { main };
