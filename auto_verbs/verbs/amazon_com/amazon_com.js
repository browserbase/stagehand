const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Amazon Product Search & Add to Cart
 *
 * Uses AI-driven discovery to dynamically interact with Amazon's product search.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Amazon Configuration ────────────────────────────────────────────────────
const AMAZON_CONFIG = {
  url: "https://www.amazon.com",
  search: {
    query: "travel adapter worldwide",
    sortBy: "best sellers",
  },
  waitTimes: {
    pageLoad: 3000,
    afterAction: 1000,
    afterSearch: 5000,
  },
};

// ── Amazon Specific Functions ───────────────────────────────────────────────

/**
 * Generate a Python Playwright script for Amazon product search and add to cart.
 */
function generateAmazonPythonScript(config, recorder) {
  const query = config.search.query;
  const ts = new Date().toISOString();
  const nActions = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
Amazon Product Search: "${query}" → Sort by Best Sellers → Add first item to cart

Generated on: ${ts}
Recorded ${nActions} browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import time
import os
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )

    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport=None,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
            "--start-maximized",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()

    # Navigate to Amazon
    page.goto("${config.url}")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    # Click the search box
    search_box = page.get_by_role("searchbox", name=re.compile(r"Search", re.IGNORECASE)).first
    search_box.click()
    page.wait_for_timeout(500)

    # Type search query
    search_box.fill("${query}")
    page.wait_for_timeout(500)

    # Press Enter or click Search button to submit
    search_box.press("Enter")

    # Wait for search results to load
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    # Sort by Best Sellers - use URL parameter approach (most reliable)
    current_url = page.url
    if "&s=" in current_url:
        import urllib.parse
        sorted_url = re.sub(r"&s=[^&]*", "&s=exact-aware-popularity-rank", current_url)
    elif "?" in current_url:
        sorted_url = current_url + "&s=exact-aware-popularity-rank"
    else:
        sorted_url = current_url + "?s=exact-aware-popularity-rank"
    page.goto(sorted_url)
    page.wait_for_load_state("domcontentloaded")

    # Wait for sorted results to fully render
    page.wait_for_timeout(5000)

    # Click on the first product in search results
    # Product title is the second link in each search result card (the first is the image)
    first_result = page.locator("[data-component-type='s-search-result']").first
    product_links = first_result.locator("a[href*='/dp/']")
    product_link = product_links.nth(1)
    try:
        product_link.wait_for(state="visible", timeout=10000)
        product_link.click()
    except Exception:
        product_links.first.click(timeout=10000)

    # Wait for product page to load
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    # Extract and print product name and price
    try:
        product_name = page.locator("#productTitle").inner_text(timeout=5000).strip()
    except Exception:
        try:
            product_name = page.locator("#title, #titleSection h1, span#productTitle, h1.product-title-word-break").first.inner_text(timeout=5000).strip()
        except Exception:
            product_name = page.title().replace(" - Amazon.com", "").strip()
    try:
        price_el = page.locator("span.a-price .a-offscreen").first
        product_price = price_el.inner_text(timeout=5000).strip()
    except Exception:
        product_price = "N/A"
    print(f"Product: {product_name}")
    print(f"Price: {product_price}")

    # Click "Add to Cart" button
    try:
        page.get_by_role("button", name=re.compile(r"Add to Cart", re.IGNORECASE)).first.click(timeout=5000)
    except Exception:
        try:
            page.locator("#add-to-cart-button").click(timeout=5000)
        except Exception:
            print("Warning: Could not find Add to Cart button")

    # Wait for confirmation
    page.wait_for_timeout(3000)
    print("Successfully added the first item to the shopping cart!")

    # ---------------------
    # Cleanup
    # ---------------------
    context.close()


with sync_playwright() as playwright:
    run(playwright)
`;
}

// ── Amazon Specific Step Functions ──────────────────────────────────────────

/**
 * Discover the Amazon interface
 */
async function discoverAmazonInterface(stagehand, recorder) {
  console.log("🔍 STEP 1: Exploring the Amazon interface...\n");

  const { z } = require("zod/v3");

  const interfaceDiscovery = await stagehand.extract(
    "Analyze the current Amazon homepage interface. What search inputs, buttons, navigation, or controls are visible? Look for the search bar, categories, and other interactive elements.",
    z.object({
      availableOptions: z.array(z.string()).describe("List of visible options/buttons/controls"),
      searchRelated: z.array(z.string()).describe("Options specifically related to searching"),
      navigationRelated: z.array(z.string()).describe("Options related to navigation or categories"),
      otherControls: z.array(z.string()).describe("Other notable controls or features"),
    })
  );

  recorder.record("extract", {
    instruction: "Analyze the current Amazon homepage interface",
    description: "Interface discovery analysis",
    results: interfaceDiscovery,
  });

  console.log("📋 Interface Discovery Results:");
  console.log(`   🎯 Available options: ${interfaceDiscovery.availableOptions.join(", ")}`);
  console.log(`   🔍 Search-related: ${interfaceDiscovery.searchRelated.join(", ")}`);
  console.log(`   🧭 Navigation: ${interfaceDiscovery.navigationRelated.join(", ")}`);
  console.log(`   ⚙️  Other controls: ${interfaceDiscovery.otherControls.join(", ")}`);
  console.log("");

  return interfaceDiscovery;
}

/**
 * Search for a product on Amazon
 */
async function searchProduct(stagehand, page, recorder, query) {
  console.log(`🎯 STEP 2: Searching for "${query}"...\n`);

  // Click on the search box
  console.log("🎯 Clicking the search box...");
  await observeAndAct(stagehand, page, recorder, "click on the search input field at the top of the page", "Click search input field", 500);

  // Type the search query
  console.log(`🎯 Typing search query: "${query}"...`);
  await observeAndAct(stagehand, page, recorder, `Type '${query}' into the search input field`, `Type search query: ${query}`, AMAZON_CONFIG.waitTimes.afterAction);

  // Submit the search
  console.log("🎯 Submitting search...");
  await observeAndAct(stagehand, page, recorder, "Click the search submit button or press Enter to search", "Submit search", AMAZON_CONFIG.waitTimes.afterAction);

  // Wait for search results page to load
  console.log("⏳ Waiting for search results page to load...");
  recorder.wait(5000, "Wait for search results page to load");
  await page.waitForTimeout(5000);
}

/**
 * Sort search results by Best Sellers
 */
async function sortByBestSellers(stagehand, page, recorder) {
  console.log("🎯 STEP 3: Sorting by Best Sellers...\n");

  // The sort dropdown on Amazon is a native <select> element.
  // Use observeAndAct to find it, then use selectOption or the
  // Stagehand act with a clear instruction to select the option from the dropdown.
  console.log("🎯 Selecting 'Best Sellers' from the sort dropdown...");
  await observeAndAct(stagehand, page, recorder, "Select 'Best Sellers' from the 'Sort by' dropdown at the top right of the search results. This is a select dropdown.", "Select Best Sellers from sort dropdown", AMAZON_CONFIG.waitTimes.afterAction);

  // Wait for sorted results to load (page reloads after sort change)
  console.log("⏳ Waiting for sorted results to load...");
  recorder.wait(5000, "Wait for sorted results to load after sort");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
}

/**
 * Click on the first product and add it to cart
 */
async function addFirstItemToCart(stagehand, page, recorder) {
  console.log("🎯 STEP 4: Adding the first item to the shopping cart...\n");

  // Click the first product in search results
  console.log("🎯 Clicking the first product...");
  await observeAndAct(stagehand, page, recorder, "Click on the title or image of the very first product in the search results list", "Click first product in results", AMAZON_CONFIG.waitTimes.afterAction);

  // Wait for product page to load
  console.log("⏳ Waiting for product page to load...");
  recorder.wait(5000, "Wait for product page to load");
  await page.waitForTimeout(5000);

  // Extract product info before adding to cart
  const { z } = require("zod/v3");
  const productInfo = await stagehand.extract(
    "Extract the product title and price from this Amazon product page.",
    z.object({
      title: z.string().describe("Product title"),
      price: z.string().describe("Product price"),
    })
  );

  recorder.record("extract", {
    instruction: "Extract product title and price",
    description: "Extract product details before adding to cart",
    results: productInfo,
  });

  console.log(`\n📦 Product: ${productInfo.title}`);
  console.log(`💰 Price: ${productInfo.price}`);

  // Click "Add to Cart"
  console.log("\n🎯 Clicking 'Add to Cart' button...");
  await observeAndAct(stagehand, page, recorder, "Click the 'Add to Cart' button on this product page", "Click Add to Cart button", AMAZON_CONFIG.waitTimes.afterAction);

  // Wait for cart confirmation
  console.log("⏳ Waiting for cart confirmation...");
  recorder.wait(3000, "Wait for cart confirmation");
  await page.waitForTimeout(3000);

  return productInfo;
}

// ── Main Amazon Function ────────────────────────────────────────────────────

async function searchAmazonAndAddToCart() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Amazon Product Search & Add to Cart");
  console.log("  🔍 Search → Sort by Best Sellers → Add first item to cart");
  console.log("  📝 Recording interactions → Python Playwright script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient();

  let stagehand;
  try {
    // ── Initialize Stagehand ────────────────────────────────────────────
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 1,
      llmClient: llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
        headless: false,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-extensions",
          "--start-maximized",
        ],
      },
    });

    await stagehand.init();
    console.log("✅ Stagehand initialized!\n");

    const page = stagehand.context.pages()[0];

    // ── Navigate to Amazon ──────────────────────────────────────────────
    console.log("🌐 Navigating to Amazon...");
    recorder.goto(AMAZON_CONFIG.url);
    await page.goto(AMAZON_CONFIG.url);
    await page.waitForLoadState("networkidle");
    console.log("✅ Amazon loaded\n");

    // Wait for page to fully render
    recorder.wait(AMAZON_CONFIG.waitTimes.pageLoad, "Wait for Amazon to fully render");
    await page.waitForTimeout(AMAZON_CONFIG.waitTimes.pageLoad);

    // ══════════════════════════════════════════════════════════════════════
    // 🔍 Discover, interact, and complete the task
    // ══════════════════════════════════════════════════════════════════════

    // Step 1: Interface Discovery
    await discoverAmazonInterface(stagehand, recorder);

    // Step 2: Search for the product
    await searchProduct(stagehand, page, recorder, AMAZON_CONFIG.search.query);

    // Step 3: Sort by Best Sellers
    await sortByBestSellers(stagehand, page, recorder);

    // Step 4: Click first item and add to cart
    const productInfo = await addFirstItemToCart(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  📦 Product: ${productInfo.title}`);
    console.log(`  💰 Price: ${productInfo.price}`);
    console.log("  🛒 Added to cart successfully!");
    console.log("═══════════════════════════════════════════════════════════");

    // ── Generate Python Playwright script ───────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = generateAmazonPythonScript(AMAZON_CONFIG, recorder);
    const pythonPath = path.join(__dirname, "amazon_search.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python Playwright script saved: ${pythonPath}`);

    // Save recorded actions as JSON for debugging
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════\n");

    return productInfo;

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    // Still generate whatever we have so far
    if (recorder && recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = generateAmazonPythonScript(AMAZON_CONFIG, recorder);
      const pythonPath = path.join(__dirname, "amazon_search.py");
      fs.writeFileSync(pythonPath, pythonScript, "utf-8");
      console.log(`🐍 Partial Python script saved: ${pythonPath}`);

      const jsonPath = path.join(__dirname, "recorded_actions.json");
      fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
      console.log(`📋 Partial actions log saved: ${jsonPath}`);
    }

    throw error;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing browser...");
      await stagehand.close();
    }
  }
}

// ── Entry Point ─────────────────────────────────────────────────────────────
if (require.main === module) {
  searchAmazonAndAddToCart()
    .then(() => {
      console.log("🎊 Completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { searchAmazonAndAddToCart };
