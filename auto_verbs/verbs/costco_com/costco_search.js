const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Costco Product Search
 *
 * Uses AI-driven discovery to search for products on Costco.com.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Costco Search Configuration ─────────────────────────────────────────────
const COSTCO_CONFIG = {
  url: "https://www.costco.com",
  search: {
    query: "kids winter jacket",
    maxResults: 5,
  },
  waitTimes: {
    pageLoad: 3000,
    afterAction: 1000,
    afterSearch: 5000,
  },
};

// ── Python Script Generator ─────────────────────────────────────────────────

function generateCostcoSearchPythonScript(config, recorder) {
  const query = config.search.query;
  const maxResults = config.search.maxResults;
  const ts = new Date().toISOString();
  const nActions = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
Costco Product Search: "${query}"

Generated on: ${ts}
Recorded ${nActions} browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os, sys, shutil
from playwright.sync_api import Playwright, sync_playwright, expect

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(playwright: Playwright, search_query: str = "${query}", max_results: int = ${maxResults}) -> list:
    """
    Search Costco.com for the given query and return up to max_results items,
    each with name and price.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("costco_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    results = []

    try:
        # Navigate to Costco
        page.goto("${config.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Find and fill the search box
        search_input = page.get_by_role("combobox", name=re.compile(r"Search Costco", re.IGNORECASE)).first
        if not search_input.is_visible(timeout=3000):
            search_input = page.get_by_role("searchbox", name=re.compile(r"Search", re.IGNORECASE)).first
        search_input.click()
        search_input.fill(search_query)
        page.wait_for_timeout(500)

        # Click the Search button
        try:
            search_btn = page.get_by_role("button", name=re.compile(r"^Search$", re.IGNORECASE)).first
            search_btn.click()
        except Exception:
            search_input.press("Enter")

        # Wait for search results to load
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # Extract product listings from the results page
        # Costco uses MUI and product links have '.product.' in href
        all_links = page.get_by_role("link").all()
        product_candidates = []
        seen_hrefs = set()
        for link in all_links:
            try:
                href = link.get_attribute("href", timeout=1000) or ""
                label = link.inner_text(timeout=1000).strip()
                # Product pages have '.product.' in the URL
                if ".product." in href and len(label) > 10 and href not in seen_hrefs:
                    seen_hrefs.add(href)
                    product_candidates.append({"element": link, "name": label, "href": href})
            except Exception:
                continue

        # For each product link, find the nearby price by walking up ancestor levels
        for candidate in product_candidates[:max_results]:
            name = candidate["name"]
            price = "N/A"
            try:
                el = candidate["element"]
                for level in range(1, 8):
                    xpath = "xpath=" + "/".join([".."] * level)
                    parent = el.locator(xpath)
                    if parent.count() == 0:
                        continue
                    parent_text = parent.first.inner_text(timeout=2000)
                    price_match = re.search(r"\\$[\\d,]+\\.?\\d*", parent_text)
                    if price_match:
                        price = price_match.group(0)
                        break
            except Exception:
                pass
            results.append({"name": name, "price": price})

        if not results:
            print("Warning: Could not find product listings.")

        # Print results
        print(f"\\nFound {len(results)} results for '{search_query}':\\n")
        for i, item in enumerate(results, 1):
            print(f"  {i}. {item['name']}")
            print(f"     Price: {item['price']}")

    except Exception as e:
        print(f"Error searching Costco: {e}")
    finally:
        try:

            browser.close()

        except Exception:

            pass

        chrome_proc.terminate()

        shutil.rmtree(profile_dir, ignore_errors=True)

    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"\\nTotal items found: {len(items)}")
`;
}

// ── Stagehand Discovery Steps ───────────────────────────────────────────────

async function discoverCostcoInterface(stagehand, recorder) {
  console.log("🔍 STEP 1: Exploring the Costco interface...\n");

  const { z } = require("zod/v3");

  const interfaceDiscovery = await stagehand.extract(
    "Analyze the current Costco homepage. What search inputs, buttons, or controls are visible? Look for the main product search box.",
    z.object({
      availableOptions: z.array(z.string()).describe("List of visible options/buttons/controls"),
      searchRelated: z.array(z.string()).describe("Options related to searching for products"),
      otherControls: z.array(z.string()).describe("Other notable controls or features"),
    })
  );

  recorder.record("extract", {
    instruction: "Analyze the current Costco homepage interface",
    description: "Interface discovery analysis",
    results: interfaceDiscovery,
  });

  console.log("📋 Interface Discovery Results:");
  console.log(`   🎯 Available options: ${interfaceDiscovery.availableOptions.join(", ")}`);
  console.log(`   🔍 Search-related: ${interfaceDiscovery.searchRelated.join(", ")}`);
  console.log(`   ⚙️  Other controls: ${interfaceDiscovery.otherControls.join(", ")}`);
  console.log("");

  return interfaceDiscovery;
}

async function searchForProduct(stagehand, page, recorder, query) {
  console.log(`🎯 STEP 2: Searching for "${query}"...\n`);

  // Click on the search box
  console.log("🎯 Clicking the search box...");
  await observeAndAct(stagehand, page, recorder,
    "Click on the main 'Search Costco' input field in the header",
    "Click search input",
    500
  );

  // Type the search query
  console.log(`🎯 Typing search query: "${query}"...`);
  await observeAndAct(stagehand, page, recorder,
    `Type '${query}' into the currently focused search input field`,
    `Type search query: ${query}`,
    COSTCO_CONFIG.waitTimes.afterAction
  );

  // Click the Search button
  console.log("🎯 Clicking Search button...");
  await observeAndAct(stagehand, page, recorder,
    "Click the 'Search' button to submit the search query",
    "Click Search button",
    COSTCO_CONFIG.waitTimes.afterSearch
  );

  // Wait for results to load
  console.log("⏳ Waiting for search results...");
  recorder.wait(5000, "Wait for search results to load");
  await page.waitForTimeout(5000);
}

async function extractSearchResults(stagehand, page, recorder, maxResults) {
  console.log(`🎯 STEP 3: Extracting up to ${maxResults} search results...\n`);

  const { z } = require("zod/v3");

  const listings = await stagehand.extract(
    `Extract the product search results visible on the page. For each product, get the product name and the price. Get at most ${maxResults} products.`,
    z.object({
      products: z.array(
        z.object({
          name: z.string().describe("Product name/title"),
          price: z.string().describe("Product price"),
        })
      ).describe(`List of products (at most ${maxResults})`),
    })
  );

  recorder.record("extract", {
    instruction: "Extract product search results",
    description: `Extract up to ${maxResults} product listings with name and price`,
    results: listings,
  });

  console.log(`\n📋 Found ${listings.products.length} products:`);
  listings.products.forEach((item, i) => {
    console.log(`   ${i + 1}. ${item.name}`);
    console.log(`      💰 Price: ${item.price}`);
  });

  return listings;
}

// ── Main Function ───────────────────────────────────────────────────────────

async function searchCostco() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Costco – Product Search");
  console.log("  🔍 Discover the interface dynamically (like a human would)");
  console.log("  📝 Recording interactions → Python Playwright script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");

  let stagehand;
  try {
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

    // Navigate to Costco
    console.log("🌐 Navigating to Costco...");
    recorder.goto(COSTCO_CONFIG.url);
    await page.goto(COSTCO_CONFIG.url);
    await page.waitForLoadState("networkidle");
    console.log("✅ Costco loaded\n");

    recorder.wait(COSTCO_CONFIG.waitTimes.pageLoad, "Wait for Costco to fully render");
    await page.waitForTimeout(COSTCO_CONFIG.waitTimes.pageLoad);

    // Step 1: Interface Discovery
    await discoverCostcoInterface(stagehand, recorder);

    // Step 2: Search for Product
    await searchForProduct(stagehand, page, recorder, COSTCO_CONFIG.search.query);

    // Step 3: Extract Results
    const listings = await extractSearchResults(stagehand, page, recorder, COSTCO_CONFIG.search.maxResults);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  🔍 Query: "${COSTCO_CONFIG.search.query}"`);
    console.log(`  📦 Found ${listings.products.length} products:`);
    listings.products.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.name} - ${item.price}`);
    });
    console.log("═══════════════════════════════════════════════════════════");

    // Generate Python Playwright script
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = generateCostcoSearchPythonScript(COSTCO_CONFIG, recorder);
    const pythonPath = path.join(__dirname, "costco_search.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python script preserved (hand-maintained via CDP)`);

    const jsonPath = path.join(__dirname, "recorded_actions_search.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════\n");

    return listings;

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (recorder && recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = generateCostcoSearchPythonScript(COSTCO_CONFIG, recorder);
      const pythonPath = path.join(__dirname, "costco_search.py");
      fs.writeFileSync(pythonPath, pythonScript, "utf-8");
      console.log(`🐍 Python script preserved (hand-maintained via CDP)`);

      const jsonPath = path.join(__dirname, "recorded_actions_search.json");
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
  searchCostco()
    .then(() => {
      console.log("🎊 Completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { searchCostco };
