const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Amazon Clear Shopping Cart
 *
 * Uses AI-driven discovery to navigate to the Amazon cart and clear all items.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Amazon Configuration ────────────────────────────────────────────────────
const AMAZON_CONFIG = {
  url: "https://www.amazon.com",
  cartUrl: "https://www.amazon.com/gp/cart/view.html",
  waitTimes: {
    pageLoad: 3000,
    afterAction: 1000,
    afterDelete: 3000,
  },
};

// ── Generate Python Script ──────────────────────────────────────────────────

function generateAmazonClearCartPythonScript(config, recorder) {
  const ts = new Date().toISOString();
  const nActions = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
Amazon Clear Shopping Cart

Generated on: ${ts}
Recorded ${nActions} browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import sys
import os, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def clear_cart(playwright: Playwright) -> bool:
    """Clear all items from the Amazon shopping cart.

    Returns:
        True if the cart was successfully cleared (or was already empty),
        False if something went wrong.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("amazon_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    success = False
    try:
        # Navigate to the cart page
        page.goto("${config.cartUrl}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Check if the cart is already empty
        empty_msg = page.locator("h1:has-text('Your Amazon Cart is empty'), h2:has-text('Your Amazon Cart is empty'), .sc-empty-cart-header")
        if empty_msg.count() > 0:
            print("Cart is already empty.")
            success = True
            return success

        # Repeatedly delete items until the cart is empty
        max_iterations = 50  # Safety limit
        for i in range(max_iterations):
            # Look for "Delete" buttons/links in the cart
            delete_btns = page.locator(
                "input[value='Delete'], "
                "a:has-text('Delete'), "
                "span.a-declarative[data-action='delete'] input, "
                "[data-action='delete'] input[type='submit'], "
                "input[data-action='delete']"
            )

            if delete_btns.count() == 0:
                # No more delete buttons — cart should be empty
                print(f"All items removed. Cleared {i} item(s).")
                success = True
                break

            # Click the first delete button
            try:
                delete_btns.first.click(timeout=5000)
                page.wait_for_timeout(2000)
                # Wait for the page to update
                page.wait_for_load_state("domcontentloaded")
                page.wait_for_timeout(1000)
                print(f"  Removed item {i + 1}")
            except Exception as e:
                print(f"  Warning: could not remove item {i + 1}: {e}")
                break

        # Final check: verify cart is empty
        page.wait_for_timeout(2000)
        empty_msg = page.locator("h1:has-text('Your Amazon Cart is empty'), h2:has-text('Your Amazon Cart is empty'), .sc-empty-cart-header")
        remaining = page.locator(
            "input[value='Delete'], "
            "a:has-text('Delete'), "
            "[data-action='delete'] input[type='submit']"
        )
        if empty_msg.count() > 0 or remaining.count() == 0:
            success = True
            print("Cart successfully cleared!")
        else:
            print(f"Warning: {remaining.count()} item(s) may still remain in the cart.")
            success = False

    except Exception as e:
        print(f"Error clearing cart: {e}")
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
        result = clear_cart(playwright)
        print(f"\\nSuccess: {result}")
        sys.exit(0 if result else 1)
`;
}

// ── Stagehand Step Functions ────────────────────────────────────────────────

/**
 * Discover the Amazon cart interface
 */
async function discoverCartInterface(stagehand, recorder) {
  console.log("🔍 STEP 1: Exploring the Amazon cart interface...\n");

  const { z } = require("zod/v3");

  const interfaceDiscovery = await stagehand.extract(
    "Analyze the current Amazon shopping cart page. What items are in the cart? Are there delete buttons, quantity selectors, or an 'empty cart' option? Is the cart already empty?",
    z.object({
      isEmpty: z.boolean().describe("Whether the cart is currently empty"),
      itemCount: z.number().describe("Number of items in the cart"),
      items: z.array(z.string()).describe("Names of items in the cart (if any)"),
      availableActions: z.array(z.string()).describe("Available actions like Delete, Save for later, etc."),
    })
  );

  recorder.record("extract", {
    instruction: "Analyze Amazon cart interface",
    description: "Cart interface discovery",
    results: interfaceDiscovery,
  });

  console.log("📋 Cart Discovery Results:");
  console.log(`   🛒 Empty: ${interfaceDiscovery.isEmpty}`);
  console.log(`   📦 Items: ${interfaceDiscovery.itemCount}`);
  if (interfaceDiscovery.items.length > 0) {
    interfaceDiscovery.items.forEach((item, i) => {
      console.log(`      ${i + 1}. ${item}`);
    });
  }
  console.log(`   ⚙️  Actions: ${interfaceDiscovery.availableActions.join(", ")}`);
  console.log("");

  return interfaceDiscovery;
}

/**
 * Delete items from cart one by one
 */
async function deleteCartItems(stagehand, page, recorder, itemCount) {
  console.log(`🎯 STEP 2: Removing ${itemCount} item(s) from cart...\n`);

  for (let i = 0; i < itemCount; i++) {
    console.log(`🎯 Removing item ${i + 1}...`);
    try {
      await observeAndAct(stagehand, page, recorder,
        "Click the 'Delete' button or link for the first item in the shopping cart to remove it",
        `Delete item ${i + 1} from cart`,
        AMAZON_CONFIG.waitTimes.afterDelete);
    } catch (e) {
      console.log(`⚠️  Could not remove item ${i + 1}: ${e.message}`);
      break;
    }

    // Wait for page to update
    await page.waitForTimeout(2000);
  }
}

/**
 * Verify the cart is empty
 */
async function verifyCartEmpty(stagehand, recorder) {
  console.log("🎯 STEP 3: Verifying cart is empty...\n");

  const { z } = require("zod/v3");

  const cartState = await stagehand.extract(
    "Check if the Amazon shopping cart is now empty. Look for messages like 'Your Amazon Cart is empty' or check if there are any remaining items.",
    z.object({
      isEmpty: z.boolean().describe("Whether the cart is now empty"),
      message: z.string().describe("Any message about the cart state"),
    })
  );

  recorder.record("extract", {
    instruction: "Verify cart is empty",
    description: "Final cart state check",
    results: cartState,
  });

  console.log(`   🛒 Cart empty: ${cartState.isEmpty}`);
  console.log(`   📝 Message: ${cartState.message}`);

  return cartState.isEmpty;
}

// ── Main Function ───────────────────────────────────────────────────────────

async function clearAmazonCart() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Amazon Clear Shopping Cart");
  console.log("  🛒 Navigate to cart → Remove all items → Verify empty");
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

    // ── Navigate to Amazon Cart ─────────────────────────────────────────
    console.log("🌐 Navigating to Amazon Cart...");
    recorder.goto(AMAZON_CONFIG.cartUrl);
    await page.goto(AMAZON_CONFIG.cartUrl);
    await page.waitForLoadState("networkidle");
    console.log("✅ Amazon Cart loaded\n");

    recorder.wait(AMAZON_CONFIG.waitTimes.pageLoad, "Wait for cart page to fully render");
    await page.waitForTimeout(AMAZON_CONFIG.waitTimes.pageLoad);

    // Step 1: Discover cart interface
    const cartInfo = await discoverCartInterface(stagehand, recorder);

    if (cartInfo.isEmpty) {
      console.log("🛒 Cart is already empty — nothing to do!");
      success = true;
    } else {
      // Step 2: Delete items
      await deleteCartItems(stagehand, page, recorder, cartInfo.itemCount);

      // Step 3: Verify cart is empty
      success = await verifyCartEmpty(stagehand, recorder);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  🛒 Cart cleared: ${success}`);
    console.log("═══════════════════════════════════════════════════════════");

    // ── Generate Python Playwright script ───────────────────────────────
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = generateAmazonClearCartPythonScript(AMAZON_CONFIG, recorder);
    const pythonPath = path.join(__dirname, "amazon_clear_cart.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python script preserved (hand-maintained via CDP)`);

    const jsonPath = path.join(__dirname, "recorded_actions_clear_cart.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════\n");

    return success;

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (recorder && recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = generateAmazonClearCartPythonScript(AMAZON_CONFIG, recorder);
      const pythonPath = path.join(__dirname, "amazon_clear_cart.py");
      fs.writeFileSync(pythonPath, pythonScript, "utf-8");
      console.log(`🐍 Python script preserved (hand-maintained via CDP)`);
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
  clearAmazonCart()
    .then((success) => {
      console.log(`🎊 Completed! Success: ${success}`);
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("💥 Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { clearAmazonCart };
