/**
 * Option A: Snapshot Extractor using Stagehand V3 Class
 *
 * Uses Stagehand's internal V3 class to handle browser management and snapshot capture.
 * This is the cleanest approach as it leverages Stagehand's exact implementation.
 *
 * Usage: node --import tsx snapshot-extractor-option-a.ts <URL>
 * Example: node --import tsx snapshot-extractor-option-a.ts https://jobs.netflix.com/jobs/12345
 */

import { V3 } from "./packages/core/lib/v3/v3";
import { captureHybridSnapshot } from "./packages/core/lib/v3/understudy/a11y/snapshot";
import fs from "fs";
import path from "path";

async function extractSnapshot(url: string) {
  console.log(`🚀 Extracting snapshot from: ${url}\n`);

  // Initialize Stagehand V3 (using local Chrome)
  const v3 = new V3({
    env: "LOCAL",
    verbose: 1,
    headless: true, // Set to false if you want to see the browser
    domSettleTimeoutMs: 2000, // Wait 2 seconds for page to settle
  });

  try {
    // Initialize the browser
    console.log("🌐 Launching browser...");
    await v3.init();

    // Get the internal Stagehand Page object
    // v3.context.pages() returns Stagehand's internal Page objects (not Playwright pages)
    const stagehandPage = v3.context.pages()[0];

    if (!stagehandPage) {
      throw new Error("No page found in context");
    }

    // Navigate to the URL
    console.log("📄 Navigating to URL...");
    await stagehandPage.goto(url, {
      waitUntil: "networkidle", // Wait until network is idle
    });

    // Wait a bit for any dynamic content to load
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log("📸 Capturing hybrid snapshot...");

    // Capture the hybrid snapshot (this is Stagehand's exact function)
    // The Page object from v3.context.pages() is the correct type
    const snapshot = await captureHybridSnapshot(stagehandPage, {
      pierceShadow: true, // Pierce shadow DOM
      experimental: false,
    });

    // Create output directory
    const outputDir = path.join(process.cwd(), "snapshot-output");
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Generate timestamp for unique filenames
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const sanitizedUrl = url.replace(/[^a-z0-9]/gi, "_").substring(0, 50);
    const prefix = `${sanitizedUrl}_${timestamp}`;

    // Save outputs
    console.log("\n💾 Saving outputs...");

    // 1. Accessibility Tree (what the LLM reads)
    const snapshotPath = path.join(outputDir, `${prefix}_snapshot.txt`);
    fs.writeFileSync(snapshotPath, snapshot.combinedTree, "utf-8");
    console.log(`✅ Accessibility tree: ${snapshotPath}`);

    // 2. XPath Map (element ID → XPath mapping)
    const xpathMapPath = path.join(outputDir, `${prefix}_xpath-map.json`);
    fs.writeFileSync(
      xpathMapPath,
      JSON.stringify(snapshot.combinedXpathMap, null, 2),
      "utf-8"
    );
    console.log(`✅ XPath map: ${xpathMapPath}`);

    // 3. URL Map (element ID → URL for links)
    const urlMapPath = path.join(outputDir, `${prefix}_url-map.json`);
    fs.writeFileSync(
      urlMapPath,
      JSON.stringify(snapshot.combinedUrlMap, null, 2),
      "utf-8"
    );
    console.log(`✅ URL map: ${urlMapPath}`);

    // 4. Example LLM Prompt
    const llmPrompt = generateLLMPromptExample(snapshot.combinedTree);
    const promptPath = path.join(outputDir, `${prefix}_llm-prompt.txt`);
    fs.writeFileSync(promptPath, llmPrompt, "utf-8");
    console.log(`✅ LLM prompt template: ${promptPath}`);

    // 5. Summary JSON
    const summary = {
      url,
      timestamp: new Date().toISOString(),
      stats: {
        totalElements: Object.keys(snapshot.combinedXpathMap).length,
        totalLinks: Object.keys(snapshot.combinedUrlMap).length,
        treeLineCount: snapshot.combinedTree.split("\n").length,
        treeCharCount: snapshot.combinedTree.length,
      },
      files: {
        snapshot: path.basename(snapshotPath),
        xpathMap: path.basename(xpathMapPath),
        urlMap: path.basename(urlMapPath),
        llmPrompt: path.basename(promptPath),
      },
    };
    const summaryPath = path.join(outputDir, `${prefix}_summary.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
    console.log(`✅ Summary: ${summaryPath}`);

    console.log("\n📊 Stats:");
    console.log(`   - Total elements: ${summary.stats.totalElements}`);
    console.log(`   - Total links: ${summary.stats.totalLinks}`);
    console.log(`   - Tree lines: ${summary.stats.treeLineCount}`);
    console.log(`   - Tree characters: ${summary.stats.treeCharCount}`);

    console.log("\n✨ Done! All outputs saved to:", outputDir);

  } catch (error) {
    console.error("❌ Error:", error);
    throw error;
  } finally {
    // Clean up
    console.log("\n🧹 Cleaning up...");
    await v3.context.close();
    process.exit(0);
  }
}

function generateLLMPromptExample(accessibilityTree: string): string {
  return `SYSTEM PROMPT:
You are helping the user automate the browser by finding elements based on what action the user wants to take on the page.

You will be given:
1. A user-defined instruction about what action to take
2. A hierarchical accessibility tree showing the semantic structure of the page

Your task is to identify the correct element and return a structured response.

Response Format (JSON):
{
  "elementId": "string (e.g., '1-42')",
  "description": "string (human-readable description of the element)",
  "method": "string (e.g., 'click', 'fill', 'select')",
  "arguments": ["array of strings (e.g., ['text to type'])"],
  "twoStep": "boolean (true if dropdown needs to be opened first)"
}

---

USER PROMPT:
instruction: <YOUR_INSTRUCTION_HERE>

For example:
- "fill the email field with test@example.com"
- "click the submit button"
- "select 'California' from the state dropdown"

Accessibility Tree:
${accessibilityTree}

---

EXPECTED LLM RESPONSE FORMAT:
{
  "elementId": "1-XX",
  "description": "Description of the matched element",
  "method": "click|fill|select|hover|press",
  "arguments": [],
  "twoStep": false
}
`;
}

// Main execution
const url = process.argv[2];

if (!url) {
  console.error("❌ Error: Please provide a URL as an argument");
  console.log("\nUsage: node --import tsx snapshot-extractor-option-a.ts <URL>");
  console.log("Example: node --import tsx snapshot-extractor-option-a.ts https://jobs.netflix.com/jobs/12345");
  process.exit(1);
}

extractSnapshot(url).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
