const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct, extractAriaScopeForXPath } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Redfin Rental Search
 *
 * Uses AI-driven discovery to dynamically interact with Redfin's rental search.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Redfin Configuration ────────────────────────────────────────────────────
const REDFIN_CONFIG = {
  url: "https://www.redfin.com/rentals",
  search: {
    location: "Redmond, WA",
    minPrice: 1500,
    maxPrice: 3000,
  },
  waitTimes: {
    pageLoad: 3000,
    afterAction: 1000,
    afterSearch: 5000,
  },
};

// ── Redfin Specific Functions ───────────────────────────────────────────────

/**
 * Generate a Python Playwright script for Redfin rental search.
 * This replaces the generic recorder.generatePythonScript() with a
 * battle-tested template that handles Redfin's quirks:
 *   - URL rewriting for /apartments-for-rent (autocomplete redirects to For Sale)
 *   - Robust selectors with fallbacks for price filter, autocomplete, etc.
 *   - Runtime extraction of apartment listings (not hardcoded)
 */
function generateRedfinPythonScript(config, recorder) {
  const loc = config.search.location;
  const minP = config.search.minPrice;
  const maxP = config.search.maxPrice;
  const ts = new Date().toISOString();
  const nActions = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
Redfin Rental Search: ${loc} with price filter ($${minP}-$${maxP})

Generated on: ${ts}
Recorded ${nActions} browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os, sys, shutil
from playwright.sync_api import Playwright, sync_playwright, expect

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def extract_listings(page, max_listings=5):
    """Extract apartment rental listings from the current search results page."""
    listings = []
    seen_addresses = set()

    # Try common Redfin rental card selectors
    card_selectors = [
        "[data-rf-test-id='photo-card']",
        ".RentalHomeCard",
        ".HomeCard",
        "[class*='HomeCard']",
        "[class*='RentalCard']",
        "[class*='rental-card']",
        ".MapHomeCard",
    ]

    cards = None
    for sel in card_selectors:
        found = page.locator(sel)
        if found.count() > 0:
            cards = found
            break

    if not cards or cards.count() == 0:
        print("Warning: Could not find listing cards on the page.")
        return listings

    total = cards.count()
    for i in range(total):
        if len(listings) >= max_listings:
            break
        card = cards.nth(i)
        try:
            text = card.inner_text(timeout=3000)
            lines = [l.strip() for l in text.split("\\n") if l.strip()]

            listing = {}

            # --- Extract price (e.g. "$1,879+/mo", "Studio: $2,060") ---
            for line in lines:
                if re.search(r"\\$[\\d,]+", line) and "price" not in listing:
                    listing["price"] = line.strip()
                    break

            # --- Extract address from dedicated element ---
            address = None
            try:
                addr_el = card.locator(
                    "[class*='address' i], [class*='Address'], "
                    "[data-rf-test-id='abp-homeinfo-homeAddress'], "
                    "[class*='homecardV2__address' i]"
                ).first
                if addr_el.is_visible(timeout=1000):
                    address = addr_el.inner_text(timeout=1000).strip()
            except Exception:
                pass

            # Fallback: look for a line that looks like a street address
            if not address:
                for line in lines:
                    if re.search(r"\\d+\\s+\\w+\\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Cir|Way|Pl)", line, re.IGNORECASE):
                        address = line.strip()
                        break

            # Fallback: try the property name (first meaningful line)
            if not address:
                for line in lines:
                    if (not re.search(r"^\\$", line)
                            and not re.search(r"(WALKTHROUGH|ABOUT|FREE|WEEKS)", line, re.IGNORECASE)
                            and len(line) > 3):
                        address = line.strip()
                        break

            # Clean up address: remove newlines and pipe separators
            if address:
                address = re.sub(r"\\s*\\n\\s*\\|?\\s*", ", ", address).strip(", ")
            listing["address"] = address or "N/A"

            # Deduplicate by address
            addr_key = listing["address"].lower().strip()
            if addr_key in seen_addresses:
                continue
            seen_addresses.add(addr_key)

            # --- Extract beds / baths / sqft ---
            for line in lines:
                # Only match short lines for beds/baths/sqft to avoid description text
                if len(line) > 80:
                    continue
                if re.search(r"\\d+\\s*(bed|bd)", line, re.IGNORECASE) and "beds" not in listing:
                    listing["beds"] = line.strip()
                elif re.search(r"\\d+\\s*(bath|ba)", line, re.IGNORECASE) and "baths" not in listing:
                    listing["baths"] = line.strip()
                elif re.search(r"[\\d,]+\\s*sq\\s*ft", line, re.IGNORECASE) and "sqft" not in listing:
                    listing["sqft"] = line.strip()

            listings.append(listing)
        except Exception as e:
            print(f"Warning: Could not extract listing {i + 1}: {e}")

    return listings


def run(playwright: Playwright) -> None:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("redfin_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    # Navigate to Redfin Rentals
    page.goto("${config.url}")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(3000)

    # Click main search input field
    page.get_by_role("searchbox", name=re.compile(r"Search for properties", re.IGNORECASE)).first.click()
    page.wait_for_timeout(500)

    # Type location
    search_box = page.get_by_role("searchbox", name=re.compile(r"Search for properties", re.IGNORECASE)).first
    search_box.fill("${loc}")

    # Wait for autocomplete suggestions
    page.wait_for_timeout(2000)

    # Select autocomplete suggestion; fallback to Enter
    try:
        page.locator("[data-rf-test-id='search-input-menu'] a, .SearchInputHome_suggestionItem__lRJk6, [class*='suggestion'] a").first.click(timeout=5000)
    except Exception:
        search_box.press("Enter")

    page.wait_for_timeout(1000)

    # Wait for search results page to load
    page.wait_for_timeout(3000)
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(2000)

    # Ensure we are on the rental results page
    # Autocomplete suggestions redirect to "For Sale" — rewrite URL to /apartments-for-rent
    current_url = page.url
    if "/apartments-for-rent" not in current_url and "rent" not in current_url.lower():
        rental_url = current_url.rstrip("/") + "/apartments-for-rent"
        page.goto(rental_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

    # Click Price filter button (with fallbacks)
    price_clicked = False
    for price_selector in [
        ("button", re.compile(r"price", re.IGNORECASE)),
        ("button", re.compile(r"rent", re.IGNORECASE)),
        ("button", re.compile(r"\\\\$", re.IGNORECASE)),
    ]:
        try:
            page.get_by_role(price_selector[0], name=price_selector[1]).first.click(timeout=5000)
            price_clicked = True
            break
        except Exception:
            continue

    if not price_clicked:
        for css in ["button:has-text('Price')", "button:has-text('Rent')", "[data-rf-test-id*='price']"]:
            try:
                el = page.locator(css).first
                if el.is_visible(timeout=3000):
                    el.click()
                    price_clicked = True
                    break
            except Exception:
                continue

    # Wait for price filter dropdown
    page.wait_for_timeout(2000)

    # Enter min price
    min_input = page.get_by_placeholder(re.compile(r"min", re.IGNORECASE)).first
    min_input.click()
    min_input.fill("${minP}")
    page.wait_for_timeout(500)

    # Enter max price
    max_input = page.get_by_placeholder(re.compile(r"max", re.IGNORECASE)).first
    max_input.click()
    max_input.fill("${maxP}")
    page.wait_for_timeout(500)

    # Apply the price filter
    try:
        page.get_by_role("button", name=re.compile(r"Apply|Done|Update", re.IGNORECASE)).first.click(timeout=5000)
    except Exception:
        max_input.press("Enter")

    # Wait for filtered results to load
    page.wait_for_timeout(3000)

    # Extract apartment listings from the page
    listings = extract_listings(page, max_listings=5)

    print(f"\\nFound {len(listings)} rental listings in ${loc} ($${minP}-$${maxP}):\\n")
    for i, apt in enumerate(listings, 1):
        addr = apt.get("address", "N/A")
        price = apt.get("price", "N/A")
        beds = apt.get("beds", "")
        baths = apt.get("baths", "")
        sqft = apt.get("sqft", "")
        details = " | ".join(filter(None, [beds, baths, sqft]))
        print(f"  {i}. {addr}")
        print(f"     Price: {price}  {details}")

    # ---------------------
    # Cleanup
    # ---------------------
    try:

        browser.close()

    except Exception:

        pass

    chrome_proc.terminate()

    shutil.rmtree(profile_dir, ignore_errors=True)


with sync_playwright() as playwright:
    run(playwright)
`;
}


/**
 * Discover the Redfin rentals interface
 */
async function discoverRedfinInterface(stagehand, recorder) {
  console.log("🔍 STEP 1: Exploring the Redfin rentals interface...\n");

  const { z } = require("zod/v3");

  const interfaceDiscovery = await stagehand.extract(
    "Analyze the current Redfin rentals interface. What search inputs, filters, buttons, or controls are visible? Look for anything related to searching for rentals, location input, price filters.",
    z.object({
      availableOptions: z.array(z.string()).describe("List of visible options/buttons/controls"),
      searchRelated: z.array(z.string()).describe("Options specifically related to searching"),
      filterRelated: z.array(z.string()).describe("Options related to filtering (price, beds, etc.)"),
      otherControls: z.array(z.string()).describe("Other notable controls or features"),
    })
  );

  recorder.record("extract", {
    instruction: "Analyze the current Redfin rentals interface",
    description: "Interface discovery analysis",
    results: interfaceDiscovery,
  });

  console.log("📋 Interface Discovery Results:");
  console.log(`   🎯 Available options: ${interfaceDiscovery.availableOptions.join(", ")}`);
  console.log(`   🔍 Search-related: ${interfaceDiscovery.searchRelated.join(", ")}`);
  console.log(`   💰 Filter-related: ${interfaceDiscovery.filterRelated.join(", ")}`);
  console.log(`   ⚙️  Other controls: ${interfaceDiscovery.otherControls.join(", ")}`);
  console.log("");

  return interfaceDiscovery;
}

/**
 * Enter search location into Redfin search box and navigate to results
 */
async function enterSearchLocation(stagehand, page, recorder, location) {
  console.log(`🎯 STEP 2: Entering search location: "${location}"...\n`);

  // Click on the main hero search box (the large one in the banner, not the header)
  console.log("🎯 Clicking the main search box...");
  await observeAndAct(stagehand, page, recorder, "click on the large search input field in the center banner area that says 'Search for properties'", "Click main search input field", 500);

  // Type the location
  console.log(`🎯 Typing location: "${location}"...`);
  await observeAndAct(stagehand, page, recorder, `Type '${location}' into the currently focused search input field`, `Type location: ${location}`, REDFIN_CONFIG.waitTimes.afterAction);

  // Wait for autocomplete suggestions to appear
  console.log("⏳ Waiting for autocomplete suggestions...");
  recorder.wait(2000, "Wait for autocomplete suggestions");
  await page.waitForTimeout(2000);

  // Click the first autocomplete suggestion
  console.log("🎯 Selecting first autocomplete suggestion...");
  await observeAndAct(stagehand, page, recorder, `Click the first autocomplete suggestion dropdown item that matches '${location}'`, "Select autocomplete suggestion", REDFIN_CONFIG.waitTimes.afterAction);

  // Wait for search results page to load
  console.log("⏳ Waiting for search results page to load...");
  recorder.wait(5000, "Wait for search results page to load");
  await page.waitForTimeout(5000);
}

/**
 * Set price range filter on the search results page
 */
async function setPriceRange(stagehand, page, recorder, minPrice, maxPrice) {
  console.log(`🎯 STEP 3: Setting price range: $${minPrice} - $${maxPrice}...\n`);

  // On the results page, click the "Price" filter button in the filter bar
  console.log("🎯 Clicking Price filter button...");
  await observeAndAct(stagehand, page, recorder, "click the 'Price' filter button in the filter bar at the top of the search results", "Click Price filter button", REDFIN_CONFIG.waitTimes.afterAction);

  // Wait for price filter dropdown to open
  console.log("⏳ Waiting for price dropdown to open...");
  recorder.wait(1000, "Wait for price filter dropdown to appear");
  await page.waitForTimeout(1000);

  // Enter minimum price
  console.log(`🎯 Entering minimum price: $${minPrice}...`);
  await observeAndAct(stagehand, page, recorder, `Click on the minimum price input field and type '${minPrice}'`, `Enter min price: $${minPrice}`, 500);

  // Enter maximum price
  console.log(`🎯 Entering maximum price: $${maxPrice}...`);
  await observeAndAct(stagehand, page, recorder, `Click on the maximum price input field and type '${maxPrice}'`, `Enter max price: $${maxPrice}`, 500);

  // Apply the price filter
  console.log("🎯 Applying price filter...");
  await observeAndAct(stagehand, page, recorder, "Click the 'Apply' or 'Done' or 'Update' button to apply the price filter range", "Apply price filter", REDFIN_CONFIG.waitTimes.afterSearch);
}

/**
 * Extract apartment listings from the results
 */
async function extractListings(stagehand, page, recorder) {
  console.log("🎯 STEP 4: Extracting apartment listings...\n");

  const { z } = require("zod/v3");

  // Wait for results to load
  console.log("⏳ Waiting for results to load...");
  recorder.wait(3000, "Wait for search results to load");
  await page.waitForTimeout(3000);

  // Extract apartment listings
  const listings = await stagehand.extract(
    "Extract the apartment rental listings visible on the page. For each listing, get the address, price (monthly rent), number of bedrooms, number of bathrooms, and square footage if available. Get at most 5 listings.",
    z.object({
      apartments: z.array(
        z.object({
          address: z.string().describe("Full address of the apartment"),
          price: z.string().describe("Monthly rent price"),
          bedrooms: z.string().optional().describe("Number of bedrooms"),
          bathrooms: z.string().optional().describe("Number of bathrooms"),
          sqft: z.string().optional().describe("Square footage"),
        })
      ).describe("List of apartment listings (at most 5)"),
    })
  );

  recorder.record("extract", {
    instruction: "Extract apartment rental listings from search results",
    description: "Extract at most 5 apartment listings with details",
    results: listings,
  });

  console.log(`\n📋 Found ${listings.apartments.length} apartments:`);
  listings.apartments.forEach((apt, i) => {
    console.log(`   ${i + 1}. ${apt.address}`);
    console.log(`      💰 Price: ${apt.price}`);
    if (apt.bedrooms) console.log(`      🛏️  Bedrooms: ${apt.bedrooms}`);
    if (apt.bathrooms) console.log(`      🚿 Bathrooms: ${apt.bathrooms}`);
    if (apt.sqft) console.log(`      📐 Sqft: ${apt.sqft}`);
  });

  return listings;
}

// ── Main Redfin Function ────────────────────────────────────────────────────

async function searchRedfinRentals() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Redfin Rental Search");
  console.log("  🔍 Discover the interface dynamically (like a human would)");
  console.log("  📝 Recording interactions → Python Playwright script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid"); // Uses hybrid (trapi + Copilot CLI fallback)

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

    // ── Navigate to Redfin Rentals ──────────────────────────────────────
    console.log("🌐 Navigating to Redfin Rentals...");
    recorder.goto(REDFIN_CONFIG.url);
    await page.goto(REDFIN_CONFIG.url);
    await page.waitForLoadState("networkidle");
    console.log("✅ Redfin Rentals loaded\n");

    // Wait for page to fully render
    recorder.wait(REDFIN_CONFIG.waitTimes.pageLoad, "Wait for Redfin to fully render");
    await page.waitForTimeout(REDFIN_CONFIG.waitTimes.pageLoad);

    // ══════════════════════════════════════════════════════════════════════
    // 🔍 Discover, interact, and extract
    // ══════════════════════════════════════════════════════════════════════

    // Step 1: Interface Discovery
    await discoverRedfinInterface(stagehand, recorder);

    // Step 2: Enter Search Location
    await enterSearchLocation(stagehand, page, recorder, REDFIN_CONFIG.search.location);

    // Step 3: Set Price Range
    await setPriceRange(stagehand, page, recorder, REDFIN_CONFIG.search.minPrice, REDFIN_CONFIG.search.maxPrice);

    // Step 4: Extract Listings
    const listings = await extractListings(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  🏠 Found ${listings.apartments.length} apartments`);
    listings.apartments.forEach((apt, i) => {
      console.log(`  ${i + 1}. ${apt.address} - ${apt.price}`);
    });
    console.log("═══════════════════════════════════════════════════════════");

    // ── Generate Python Playwright script ───────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = generateRedfinPythonScript(REDFIN_CONFIG, recorder);
    const pythonPath = path.join(__dirname, "redfin_search.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python script preserved (hand-maintained via CDP)`);

    // Save recorded actions as JSON for debugging
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════\n");

    return listings;

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    // Still generate whatever we have so far
    if (recorder && recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = generateRedfinPythonScript(REDFIN_CONFIG, recorder);
      const pythonPath = path.join(__dirname, "redfin_search.py");
      fs.writeFileSync(pythonPath, pythonScript, "utf-8");
      console.log(`🐍 Python script preserved (hand-maintained via CDP)`);

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
  searchRedfinRentals()
    .then(() => {
      console.log("🎊 Completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { searchRedfinRentals };
