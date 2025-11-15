/**
 * Option B: Snapshot Extractor with Enhanced Configuration & Batch Processing
 *
 * Shows how to use Stagehand V3 with detailed configuration and demonstrates
 * processing multiple fields/elements from a single snapshot.
 *
 * Differences from Option A:
 * - More verbose logging and debugging
 * - Longer wait times for complex SPAs
 * - Extracts additional metadata (form fields analysis)
 * - Shows element categorization (buttons, inputs, links)
 *
 * Usage: node --import tsx snapshot-extractor-option-b.ts <URL>
 * Example: node --import tsx snapshot-extractor-option-b.ts https://jobs.netflix.com/jobs/12345
 */

import { V3 } from "./packages/core/lib/v3/v3";
import { captureHybridSnapshot } from "./packages/core/lib/v3/understudy/a11y/snapshot";
import fs from "fs";
import path from "path";

interface ElementAnalysis {
  buttons: string[];
  textInputs: string[];
  links: string[];
  dropdowns: string[];
  checkboxes: string[];
  other: string[];
}

async function extractSnapshot(url: string) {
  console.log(`🚀 Extracting snapshot from: ${url}\n`);

  // Initialize Stagehand V3 with enhanced configuration
  const v3 = new V3({
    env: "LOCAL",
    verbose: 2, // Maximum logging for debugging
    headless: true, // Set to false to watch browser behavior
    domSettleTimeoutMs: 5000, // Wait 5 seconds for dynamic content (SPAs, lazy loading)
    enableCaching: false, // Always get fresh snapshot
    // debugDom: true, // Uncomment to save intermediate DOM states
  });

  try {
    // Initialize the browser
    console.log("🌐 Launching browser with enhanced configuration...");
    console.log("   - Verbose logging: ENABLED");
    console.log("   - DOM settle timeout: 5000ms");
    console.log("   - Caching: DISABLED");
    await v3.init();

    // Get the Stagehand Page object
    const stagehandPage = v3.context.pages()[0];

    if (!stagehandPage) {
      throw new Error("No page found in context");
    }

    // Navigate to the URL with extended timeout
    console.log("\n📄 Navigating to URL...");
    const startNav = Date.now();
    await stagehandPage.goto(url, {
      waitUntil: "networkidle", // Wait for network to be idle
      timeout: 60000, // 60 second timeout for slow-loading pages
    });
    const navTime = Date.now() - startNav;
    console.log(`   ✓ Page loaded in ${navTime}ms`);

    // Additional wait for dynamic content (React/Vue/Angular apps)
    console.log("\n⏳ Waiting for dynamic content to settle...");
    const settleStart = Date.now();
    await new Promise(resolve => setTimeout(resolve, 5000));
    console.log(`   ✓ Settled after ${Date.now() - settleStart}ms`);

    // Capture the hybrid snapshot
    console.log("\n📸 Capturing hybrid snapshot...");
    const snapshotStart = Date.now();
    const snapshot = await captureHybridSnapshot(stagehandPage, {
      pierceShadow: true, // Pierce shadow DOM for Web Components
      experimental: true, // Enable experimental features
    });
    const snapshotTime = Date.now() - snapshotStart;
    console.log(`   ✓ Snapshot captured in ${snapshotTime}ms`);

    // Analyze the snapshot
    console.log("\n🔍 Analyzing page structure...");
    const analysis = analyzeSnapshot(snapshot.combinedTree);

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

    // 1. Accessibility Tree
    const snapshotPath = path.join(outputDir, `${prefix}_snapshot.txt`);
    fs.writeFileSync(snapshotPath, snapshot.combinedTree, "utf-8");
    console.log(`   ✅ Accessibility tree: ${path.basename(snapshotPath)}`);

    // 2. XPath Map
    const xpathMapPath = path.join(outputDir, `${prefix}_xpath-map.json`);
    fs.writeFileSync(
      xpathMapPath,
      JSON.stringify(snapshot.combinedXpathMap, null, 2),
      "utf-8"
    );
    console.log(`   ✅ XPath map: ${path.basename(xpathMapPath)}`);

    // 3. URL Map
    const urlMapPath = path.join(outputDir, `${prefix}_url-map.json`);
    fs.writeFileSync(
      urlMapPath,
      JSON.stringify(snapshot.combinedUrlMap, null, 2),
      "utf-8"
    );
    console.log(`   ✅ URL map: ${path.basename(urlMapPath)}`);

    // 4. Element Analysis
    const analysisPath = path.join(outputDir, `${prefix}_element-analysis.json`);
    fs.writeFileSync(
      analysisPath,
      JSON.stringify(analysis, null, 2),
      "utf-8"
    );
    console.log(`   ✅ Element analysis: ${path.basename(analysisPath)}`);

    // 5. LLM Prompt Template
    const llmPrompt = generateLLMPromptExample(snapshot.combinedTree);
    const promptPath = path.join(outputDir, `${prefix}_llm-prompt.txt`);
    fs.writeFileSync(promptPath, llmPrompt, "utf-8");
    console.log(`   ✅ LLM prompt template: ${path.basename(promptPath)}`);

    // 6. Summary JSON
    const summary = {
      url,
      timestamp: new Date().toISOString(),
      timings: {
        navigationMs: navTime,
        settleMs: 5000,
        snapshotMs: snapshotTime,
        totalMs: navTime + 5000 + snapshotTime,
      },
      stats: {
        totalElements: Object.keys(snapshot.combinedXpathMap).length,
        totalLinks: Object.keys(snapshot.combinedUrlMap).length,
        treeLineCount: snapshot.combinedTree.split("\n").length,
        treeCharCount: snapshot.combinedTree.length,
      },
      elementCounts: {
        buttons: analysis.buttons.length,
        textInputs: analysis.textInputs.length,
        links: analysis.links.length,
        dropdowns: analysis.dropdowns.length,
        checkboxes: analysis.checkboxes.length,
        other: analysis.other.length,
      },
      files: {
        snapshot: path.basename(snapshotPath),
        xpathMap: path.basename(xpathMapPath),
        urlMap: path.basename(urlMapPath),
        analysis: path.basename(analysisPath),
        llmPrompt: path.basename(promptPath),
      },
    };
    const summaryPath = path.join(outputDir, `${prefix}_summary.json`);
    fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2), "utf-8");
    console.log(`   ✅ Summary: ${path.basename(summaryPath)}`);

    // Display summary
    console.log("\n📊 Page Statistics:");
    console.log(`   ⏱️  Total time: ${summary.timings.totalMs}ms`);
    console.log(`   🔢 Total elements: ${summary.stats.totalElements}`);
    console.log(`   🔗 Total links: ${summary.stats.totalLinks}`);
    console.log(`   📝 Tree lines: ${summary.stats.treeLineCount}`);
    console.log(`   📏 Tree size: ${summary.stats.treeCharCount} chars`);

    console.log("\n🎯 Interactive Elements:");
    console.log(`   🔘 Buttons: ${summary.elementCounts.buttons}`);
    console.log(`   ✍️  Text inputs: ${summary.elementCounts.textInputs}`);
    console.log(`   🔗 Links: ${summary.elementCounts.links}`);
    console.log(`   📋 Dropdowns: ${summary.elementCounts.dropdowns}`);
    console.log(`   ☑️  Checkboxes: ${summary.elementCounts.checkboxes}`);

    if (summary.elementCounts.textInputs > 0) {
      console.log("\n📝 Found Text Input Fields:");
      analysis.textInputs.slice(0, 10).forEach((field, idx) => {
        console.log(`   ${idx + 1}. ${field}`);
      });
      if (analysis.textInputs.length > 10) {
        console.log(`   ... and ${analysis.textInputs.length - 10} more`);
      }
    }

    console.log("\n✨ Done! All outputs saved to:", outputDir);

  } catch (error) {
    console.error("\n❌ Error:", error);
    throw error;
  } finally {
    // Clean up
    console.log("\n🧹 Cleaning up...");
    await v3.context.close();
    process.exit(0);
  }
}

function analyzeSnapshot(tree: string): ElementAnalysis {
  const lines = tree.split("\n");
  const analysis: ElementAnalysis = {
    buttons: [],
    textInputs: [],
    links: [],
    dropdowns: [],
    checkboxes: [],
    other: [],
  };

  for (const line of lines) {
    // Extract element ID and role
    const match = line.match(/\[([^\]]+)\]\s+(\w+):\s*(.+)/);
    if (!match) continue;

    const [, elementId, role, name] = match;
    const description = `[${elementId}] ${name}`.trim();

    // Categorize by role
    switch (role.toLowerCase()) {
      case "button":
        analysis.buttons.push(description);
        break;
      case "textbox":
        analysis.textInputs.push(description);
        break;
      case "link":
        analysis.links.push(description);
        break;
      case "combobox":
      case "listbox":
        analysis.dropdowns.push(description);
        break;
      case "checkbox":
        analysis.checkboxes.push(description);
        break;
      default:
        if (role !== "generic" && role !== "WebArea" && role !== "main") {
          analysis.other.push(description);
        }
    }
  }

  return analysis;
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

Supported methods:
- "click" - Click an element (buttons, links, etc.)
- "fill" - Type text into an input field
- "select" - Select an option from a dropdown
- "hover" - Hover over an element
- "press" - Press a keyboard key
- "scrollIntoView" - Scroll element into view

---

USER PROMPT:
instruction: <YOUR_INSTRUCTION_HERE>

Examples:
- "fill the email field with test@example.com"
- "click the submit button"
- "select 'California' from the state dropdown"
- "click the 'Apply Now' button"
- "fill the phone number field with 555-123-4567"

Accessibility Tree:
${accessibilityTree}

---

EXPECTED LLM RESPONSE FORMAT:
{
  "elementId": "1-XX",
  "description": "Description of the matched element",
  "method": "click|fill|select|hover|press|scrollIntoView",
  "arguments": [],
  "twoStep": false
}

Example response for "fill the email field with test@example.com":
{
  "elementId": "1-42",
  "description": "Email Address input field",
  "method": "fill",
  "arguments": ["test@example.com"],
  "twoStep": false
}

Example response for "click the submit button":
{
  "elementId": "1-50",
  "description": "Submit Application button",
  "method": "click",
  "arguments": [],
  "twoStep": false
}
`;
}

// Main execution
const url = process.argv[2];

if (!url) {
  console.error("❌ Error: Please provide a URL as an argument");
  console.log("\nUsage: node --import tsx snapshot-extractor-option-b.ts <URL>");
  console.log("Example: node --import tsx snapshot-extractor-option-b.ts https://jobs.netflix.com/jobs/12345");
  process.exit(1);
}

extractSnapshot(url).catch((error) => {
  console.error("❌ Fatal error:", error);
  process.exit(1);
});
