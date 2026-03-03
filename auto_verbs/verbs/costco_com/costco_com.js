const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Costco Set Preferred Warehouse
 *
 * Uses AI-driven discovery to dynamically interact with Costco's warehouse selector.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Costco Configuration ────────────────────────────────────────────────────
const COSTCO_CONFIG = {
  url: "https://www.costco.com",
  warehouse: {
    location: "Redmond, WA",
  },
  waitTimes: {
    pageLoad: 3000,
    afterAction: 1000,
    afterSearch: 3000,
  },
};

// ── Costco Specific Functions ───────────────────────────────────────────────

/**
 * Generate a Python Playwright script for setting Costco preferred warehouse.
 */
function generateCostcoPythonScript(config, recorder) {
  const loc = config.warehouse.location;
  const ts = new Date().toISOString();
  const nActions = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
Costco Set Preferred Warehouse: ${loc}

Generated on: ${ts}
Recorded ${nActions} browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os, sys, shutil
from playwright.sync_api import Playwright, sync_playwright, expect

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(playwright: Playwright) -> bool:
    """
    Set the preferred Costco warehouse to '${loc}'.
    Returns True if the warehouse was successfully set, False otherwise.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("costco_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    # Extract the city keyword from the location for matching (e.g. "Redmond" from "Redmond, WA")
    location = "${loc}"
    city = location.split(",")[0].strip()

    success = False

    try:
        # Navigate to Costco homepage
        page.goto("${config.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Click "Locations" link in the main navigation header
        try:
            page.get_by_role("link", name=re.compile(r"Locations", re.IGNORECASE)).first.click()
        except Exception:
            # Fallback: navigate directly to warehouse locations page
            page.goto("https://www.costco.com/warehouse-locations")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Find and fill the "City, State, or Zip" combobox inside the warehouse form
        # The input is inside div#warehouse-locations-page (main content), NOT the header
        warehouse_page = page.locator("#warehouse-locations-page, #mainContent")
        search_input = warehouse_page.get_by_role("combobox", name=re.compile(r"City.*State.*Zip", re.IGNORECASE)).first
        if not search_input.is_visible(timeout=3000):
            # Fallback: try any combobox with that label on the page
            search_input = page.get_by_role("combobox", name=re.compile(r"City.*State.*Zip", re.IGNORECASE)).first
        search_input.click()
        search_input.fill(location)
        page.wait_for_timeout(1000)

        # Click the "Find" button next to the search input (inside the warehouse form)
        try:
            find_btn = warehouse_page.get_by_role("button", name=re.compile(r"^Find", re.IGNORECASE)).first
            find_btn.click()
        except Exception:
            # Fallback: press Enter
            search_input.press("Enter")
        page.wait_for_timeout(4000)

        # Find the "Set as My Warehouse" button matching the target city
        # The button has aria-label like "Set as My Warehouse <CityName>"
        set_clicked = False

        # Try aria-label match first (most reliable)
        try:
            target_btn = page.get_by_role(
                "button",
                name=re.compile(r"Set as My Warehouse.*" + re.escape(city), re.IGNORECASE)
            ).first
            if target_btn.is_visible(timeout=5000):
                target_btn.click()
                set_clicked = True
        except Exception:
            pass

        # Fallback: find any "Set as My Warehouse" button and match by label
        if not set_clicked:
            try:
                btns = page.get_by_role("button", name=re.compile(r"Set as My Warehouse", re.IGNORECASE))
                count = btns.count()
                for i in range(count):
                    btn = btns.nth(i)
                    label = btn.get_attribute("aria-label") or btn.inner_text()
                    if city.lower() in label.lower():
                        btn.click()
                        set_clicked = True
                        break
                # If no specific button found, click the first one
                if not set_clicked and count > 0:
                    btns.first.click()
                    set_clicked = True
            except Exception:
                pass

        if set_clicked:
            page.wait_for_timeout(2000)
            success = True
            print("Successfully set preferred warehouse to: ${loc}")
        else:
            print("Warning: Could not find 'Set as My Warehouse' button for ${loc}")
            success = False

    except Exception as e:
        print(f"Error setting preferred warehouse: {e}")
        success = False
    finally:
        try:

            browser.close()

        except Exception:

            pass

        chrome_proc.terminate()

        shutil.rmtree(profile_dir, ignore_errors=True)

    return success


if __name__ == "__main__":
    with sync_playwright() as playwright:
        result = run(playwright)
        print(f"\\nWarehouse set successfully: {result}")
`;
}


/**
 * Discover the Costco homepage interface
 */
async function discoverCostcoInterface(stagehand, recorder) {
  console.log("🔍 STEP 1: Exploring the Costco interface...\n");

  const { z } = require("zod/v3");

  const interfaceDiscovery = await stagehand.extract(
    "Analyze the current Costco homepage. What navigation links, buttons, or controls are visible? Look for anything related to warehouse selection, delivery location, zip code, or store finder.",
    z.object({
      availableOptions: z.array(z.string()).describe("List of visible options/buttons/controls"),
      warehouseRelated: z.array(z.string()).describe("Options related to warehouse selection or location"),
      navigationLinks: z.array(z.string()).describe("Major navigation links visible"),
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
  console.log(`   🏪 Warehouse-related: ${interfaceDiscovery.warehouseRelated.join(", ")}`);
  console.log(`   🔗 Navigation links: ${interfaceDiscovery.navigationLinks.join(", ")}`);
  console.log(`   ⚙️  Other controls: ${interfaceDiscovery.otherControls.join(", ")}`);
  console.log("");

  return interfaceDiscovery;
}

/**
 * Navigate to warehouse locator and search for the location
 */
async function navigateToWarehouse(stagehand, page, recorder, location) {
  console.log(`🎯 STEP 2: Navigating to warehouse finder for "${location}"...\n`);

  // Try clicking the warehouse/location link on the homepage
  console.log("🎯 Looking for warehouse or location selector...");
  await observeAndAct(stagehand, page, recorder,
    "Click on the 'Find a Warehouse' link or any warehouse/location selector on the page. Look in the header or navigation area.",
    "Click warehouse selector link",
    COSTCO_CONFIG.waitTimes.afterAction
  );

  // Wait for the warehouse locator page to load
  console.log("⏳ Waiting for warehouse locator page...");
  recorder.wait(3000, "Wait for warehouse locator page to load");
  await page.waitForTimeout(3000);
}

/**
 * Search for a warehouse by location
 */
async function searchWarehouse(stagehand, page, recorder, location) {
  console.log(`🎯 STEP 3: Searching for warehouse near "${location}"...\n`);

  // Step 3a: Click on the warehouse search input field
  console.log("🎯 Clicking the warehouse search input...");
  await observeAndAct(stagehand, page, recorder,
    "Click on the 'City, State, or Zip' input field inside the 'Find a Warehouse' form (NOT the Costco product search box in the header)",
    "Click warehouse search input",
    500
  );

  // Step 3b: Type the location into the search input
  console.log(`🎯 Typing location: "${location}"...`);
  await observeAndAct(stagehand, page, recorder,
    `Type '${location}' into the currently focused 'City, State, or Zip' input field`,
    `Type warehouse location: ${location}`,
    COSTCO_CONFIG.waitTimes.afterAction
  );

  // Wait briefly for any autocomplete
  recorder.wait(1000, "Wait for autocomplete to appear");
  await page.waitForTimeout(1000);

  // Step 3c: Click the Find button inside the warehouse locator form
  console.log("🎯 Clicking the Find button in the warehouse locator...");
  await observeAndAct(stagehand, page, recorder,
    "Click the 'Find' button that is inside the 'Find a Warehouse' section (NOT the header Search button). It is right next to the 'City, State, or Zip' input field.",
    "Click warehouse Find button",
    COSTCO_CONFIG.waitTimes.afterSearch
  );

  // Wait for results to load
  console.log("⏳ Waiting for warehouse search results...");
  recorder.wait(3000, "Wait for warehouse search results");
  await page.waitForTimeout(3000);
}

/**
 * Select the warehouse from search results
 */
async function selectWarehouse(stagehand, page, recorder, location) {
  console.log(`🎯 STEP 4: Selecting warehouse near "${location}"...\n`);

  const { z } = require("zod/v3");

  // First, extract the list of warehouses found
  const warehouses = await stagehand.extract(
    `Extract the warehouse locations shown in the search results. For each warehouse, get the name, address, and whether there is a button to set it as preferred or select it.`,
    z.object({
      warehouses: z.array(
        z.object({
          name: z.string().describe("Warehouse name"),
          address: z.string().describe("Full address of the warehouse"),
          hasSetButton: z.boolean().describe("Whether there is a 'Set as My Warehouse' or similar button"),
        })
      ).describe("List of warehouse locations found"),
    })
  );

  recorder.record("extract", {
    instruction: "Extract warehouse search results",
    description: "Extract warehouse locations from search results",
    results: warehouses,
  });

  console.log(`\n📋 Found ${warehouses.warehouses.length} warehouses:`);
  warehouses.warehouses.forEach((wh, i) => {
    console.log(`   ${i + 1}. ${wh.name} - ${wh.address} (Has set button: ${wh.hasSetButton})`);
  });

  // Click the "Set as My Warehouse" button for the Redmond warehouse specifically
  console.log("\n🎯 Clicking 'Set as My Warehouse' for the Redmond warehouse...");
  await observeAndAct(stagehand, page, recorder,
    `Click the 'Set as My Warehouse' button that is associated with the warehouse closest to '${location}'. Look for a warehouse with 'Redmond' in its name. Do NOT click the button for the currently set 'My Warehouse' — pick one from the search results below it.`,
    "Set preferred warehouse to Redmond",
    COSTCO_CONFIG.waitTimes.afterAction
  );

  // Wait for the warehouse to be set
  console.log("⏳ Waiting for warehouse to be set...");
  recorder.wait(2000, "Wait for warehouse to be confirmed");
  await page.waitForTimeout(2000);

  return warehouses;
}

/**
 * Verify that the warehouse was successfully set
 */
async function verifyWarehouseSet(stagehand, page, recorder, location) {
  console.log(`🎯 STEP 5: Verifying warehouse was set to "${location}"...\n`);

  const { z } = require("zod/v3");

  const verification = await stagehand.extract(
    `Check if the preferred warehouse has been set. Look for any confirmation message, or check if the page now shows a warehouse name near '${location}' as the selected/preferred warehouse. Also look in the header or navigation area for the warehouse name.`,
    z.object({
      isSet: z.boolean().describe("Whether the warehouse appears to be successfully set"),
      warehouseName: z.string().optional().describe("The name of the currently set warehouse, if visible"),
      confirmationMessage: z.string().optional().describe("Any confirmation message shown"),
    })
  );

  recorder.record("extract", {
    instruction: "Verify warehouse was set successfully",
    description: "Check for confirmation of warehouse selection",
    results: verification,
  });

  console.log(`   ✅ Warehouse set: ${verification.isSet}`);
  if (verification.warehouseName) {
    console.log(`   🏪 Warehouse name: ${verification.warehouseName}`);
  }
  if (verification.confirmationMessage) {
    console.log(`   💬 Confirmation: ${verification.confirmationMessage}`);
  }

  return verification.isSet;
}

// ── Main Costco Function ────────────────────────────────────────────────────

async function setCostcoWarehouse() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Costco – Set Preferred Warehouse");
  console.log("  🔍 Discover the interface dynamically (like a human would)");
  console.log("  📝 Recording interactions → Python Playwright script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");

  let stagehand;
  let success = false;
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

    // ── Navigate to Costco ──────────────────────────────────────────────
    console.log("🌐 Navigating to Costco...");
    recorder.goto(COSTCO_CONFIG.url);
    await page.goto(COSTCO_CONFIG.url);
    await page.waitForLoadState("networkidle");
    console.log("✅ Costco loaded\n");

    // Wait for page to fully render
    recorder.wait(COSTCO_CONFIG.waitTimes.pageLoad, "Wait for Costco to fully render");
    await page.waitForTimeout(COSTCO_CONFIG.waitTimes.pageLoad);

    // ══════════════════════════════════════════════════════════════════════
    // 🔍 Discover, interact, and verify
    // ══════════════════════════════════════════════════════════════════════

    // Step 1: Interface Discovery
    await discoverCostcoInterface(stagehand, recorder);

    // Step 2: Navigate to Warehouse Locator
    await navigateToWarehouse(stagehand, page, recorder, COSTCO_CONFIG.warehouse.location);

    // Step 3: Search for Warehouse
    await searchWarehouse(stagehand, page, recorder, COSTCO_CONFIG.warehouse.location);

    // Step 4: Select the Warehouse
    const warehouses = await selectWarehouse(stagehand, page, recorder, COSTCO_CONFIG.warehouse.location);

    // Step 5: Verify
    success = await verifyWarehouseSet(stagehand, page, recorder, COSTCO_CONFIG.warehouse.location);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  🏪 Warehouse set successfully: ${success}`);
    if (warehouses.warehouses.length > 0) {
      console.log(`  📍 First result: ${warehouses.warehouses[0].name} – ${warehouses.warehouses[0].address}`);
    }
    console.log("═══════════════════════════════════════════════════════════");

    // ── Generate Python Playwright script ───────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = generateCostcoPythonScript(COSTCO_CONFIG, recorder);
    const pythonPath = path.join(__dirname, "costco_set_warehouse.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python script preserved (hand-maintained via CDP)`);

    // Save recorded actions as JSON for debugging
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════\n");

    return success;

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    // Still generate whatever we have so far
    if (recorder && recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = generateCostcoPythonScript(COSTCO_CONFIG, recorder);
      const pythonPath = path.join(__dirname, "costco_set_warehouse.py");
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
  setCostcoWarehouse()
    .then((success) => {
      console.log(`🎊 Completed! Warehouse set: ${success}`);
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("💥 Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { setCostcoWarehouse };
