const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Uber – Ride Price Estimate
 *
 * Gets a ride price estimate from Seattle-Tacoma International Airport
 * to Downtown Seattle. Extracts UberX and UberXL price ranges.
 *
 * Uses AI-driven discovery first; successful steps will be concretized.
 * Does not take any screenshots.
 */

// ── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.uber.com/us/en/price-estimate/",
  pickup: "Seattle-Tacoma International Airport",
  dropoff: "Downtown Seattle",
  rideTypes: ["UberX", "UberXL"],
  maxResults: 10,
  waits: { page: 5000, type: 3000, select: 2000, search: 8000 },
};

// ── genPython (inline) ──────────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Uber - Ride Price Estimate
Pickup:  ${cfg.pickup}
Dropoff: ${cfg.dropoff}

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import re
import os, sys, shutil
import traceback
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright,
    pickup: str = "${cfg.pickup}",
    dropoff: str = "${cfg.dropoff}",
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  Uber - Ride Price Estimate")
    print("=" * 59)
    print(f"  Pickup:  {pickup}")
    print(f"  Dropoff: {dropoff}\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("uber_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        print("Loading Uber price estimate page...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\\n")

        # Dismiss popups
        for selector in [
            "button:has-text('Accept')",
            "button:has-text('Close')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # STEP 1: Enter pickup location
        print(f'STEP 1: Pickup = "{pickup}"...')
        pickup_input = page.locator('input[placeholder*="pickup" i], input[placeholder*="Enter pickup" i], input[id*="pickup" i], input[name*="pickup" i]').first
        try:
            pickup_input.wait_for(state="visible", timeout=5000)
            pickup_input.evaluate("el => el.click()")
            page.wait_for_timeout(500)
            page.keyboard.press("Control+a")
            pickup_input.type(pickup, delay=50)
        except Exception:
            # Fallback: look for first input
            inputs = page.locator('input[type="text"], input:not([type])').all()
            if inputs:
                inputs[0].evaluate("el => el.click()")
                page.wait_for_timeout(500)
                page.keyboard.press("Control+a")
                inputs[0].type(pickup, delay=50)
        page.wait_for_timeout(3000)

        # Select first autocomplete suggestion
        try:
            suggestion = page.locator('[role="option"], [data-testid*="suggestion"], li[role="option"], [class*="suggestion"] li').first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
            print("  Selected pickup suggestion")
        except Exception:
            page.keyboard.press("Enter")
            print("  No suggestion, pressed Enter")
        page.wait_for_timeout(2000)

        # STEP 2: Enter dropoff location
        print(f'STEP 2: Dropoff = "{dropoff}"...')
        dropoff_input = page.locator('input[placeholder*="dropoff" i], input[placeholder*="Enter drop" i], input[placeholder*="destination" i], input[id*="dropoff" i], input[name*="dropoff" i]').first
        try:
            dropoff_input.wait_for(state="visible", timeout=5000)
            dropoff_input.evaluate("el => el.click()")
            page.wait_for_timeout(500)
            page.keyboard.press("Control+a")
            dropoff_input.type(dropoff, delay=50)
        except Exception:
            inputs = page.locator('input[type="text"], input:not([type])').all()
            if len(inputs) >= 2:
                inputs[1].evaluate("el => el.click()")
                page.wait_for_timeout(500)
                page.keyboard.press("Control+a")
                inputs[1].type(dropoff, delay=50)
        page.wait_for_timeout(3000)

        try:
            suggestion = page.locator('[role="option"], [data-testid*="suggestion"], li[role="option"], [class*="suggestion"] li').first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
            print("  Selected dropoff suggestion")
        except Exception:
            page.keyboard.press("Enter")
            print("  No suggestion, pressed Enter")
        page.wait_for_timeout(2000)

        # STEP 3: Click search / get estimate (if there's a button)
        print("STEP 3: Get price estimate...")
        try:
            search_btn = page.locator('button[type="submit"], button:has-text("See prices"), button:has-text("Get"), button:has-text("Search"), button:has-text("Estimate")').first
            if search_btn.is_visible(timeout=3000):
                search_btn.evaluate("el => el.click()")
                print("  Clicked estimate button")
        except Exception:
            print("  No explicit search button (auto-submitted?)")
        page.wait_for_timeout(8000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        print(f"  URL: {page.url}")

        # STEP 4: Extract price estimates
        print(f"STEP 4: Extract ride prices...\\n")

        # Scroll to load content
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 400)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        body_text = page.evaluate("document.body.innerText")

        # Parse ride types and prices from page text
        lines = body_text.split("\\n")
        ride_types = ${JSON.stringify(cfg.rideTypes)}
        for rt in ride_types:
            for i, line in enumerate(lines):
                if rt.lower() in line.lower():
                    # Look nearby for price pattern
                    context_lines = lines[max(0, i-2):min(len(lines), i+5)]
                    context_text = " ".join(context_lines)
                    price_match = re.search(r"\\$(\\d+(?:\\.\\d{2})?)\\s*[-\\u2013]\\s*\\$(\\d+(?:\\.\\d{2})?)", context_text)
                    if not price_match:
                        price_match = re.search(r"\\$(\\d+(?:\\.\\d{2})?)", context_text)
                    if price_match:
                        if price_match.lastindex == 2:
                            price_range = "$" + str(price_match.group(1)) + "-$" + str(price_match.group(2))
                        else:
                            price_range = "$" + str(price_match.group(1))
                        results.append({
                            "rideType": rt,
                            "priceRange": price_range,
                        })
                        break

        print(f"\\nFound {len(results)} ride estimates:")
        for r in results:
            print(f"  {r['rideType']}: {r['priceRange']}")

    except Exception as e:
        print(f"\\nError: {e}")
        traceback.print_exc()
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
        print(f"\\nTotal estimates: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  await page.waitForTimeout(2000);

  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button, a, [role="button"]');
      for (const btn of btns) {
        const txt = (btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();
        if (['close','dismiss','accept','got it','ok','no thanks','not now',
             'accept all cookies','accept all'].includes(txt)) {
          if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
            btn.click(); return txt;
          }
        }
      }
      return false;
    })()`);
    if (clicked) {
      console.log(`   ✅ Dismissed: "${clicked}"`);
      await page.waitForTimeout(800);
    } else break;
  }
  await page.waitForTimeout(500);
}

async function enterLocation(stagehand, page, recorder, locationType, locationText) {
  const label = locationType === "pickup" ? "Pickup" : "Dropoff";
  const stepNum = locationType === "pickup" ? 1 : 2;
  console.log(`🎯 STEP ${stepNum}: ${label} = "${locationText}"...`);

  // Try observe+act to find and click the input
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the ${locationType} location input field`,
      `Click ${label} input`
    );
  } catch (e) {
    // Fallback: try to find input by placeholder
    console.log(`   ⚠️ Could not find ${label} input via observe, trying selectors...`);
    const placeholders = locationType === "pickup"
      ? ['input[placeholder*="pickup" i]', 'input[placeholder*="Enter pickup" i]']
      : ['input[placeholder*="drop" i]', 'input[placeholder*="destination" i]', 'input[placeholder*="Enter drop" i]'];
    for (const sel of placeholders) {
      try {
        const inp = page.locator(sel).first;
        if (await inp.isVisible({ timeout: 2000 })) {
          await inp.click();
          break;
        }
      } catch (e2) { /* continue */ }
    }
  }
  await page.waitForTimeout(500);

  // Clear and type
  await page.keyPress("Control+a");
  await page.waitForTimeout(100);
  await page.keyPress("Backspace");
  await page.waitForTimeout(200);
  await page.type(locationText, { delay: 50 });
  console.log(`   Typed "${locationText}"`);
  recorder.record("act", { instruction: `Type '${locationText}' into ${label}`, description: `Fill ${label}: ${locationText}`, method: "type" });
  await page.waitForTimeout(CFG.waits.type);

  // Select autocomplete suggestion
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the first autocomplete suggestion that matches "${locationText}"`,
      `Select ${label} suggestion`,
      CFG.waits.select
    );
    console.log(`   ✅ Selected ${label} suggestion`);
  } catch (e) {
    console.log(`   ⚠️ No autocomplete suggestion, pressing Enter`);
    await page.keyPress("Enter");
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function clickGetEstimate(stagehand, page, recorder) {
  console.log("🎯 STEP 3: Get price estimate...");

  // Try to find and click a "See prices" / "Get" / "Search" / "Estimate" button
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the button to see prices or get an estimate`,
      "Click estimate button"
    );
    console.log("   ✅ Clicked estimate button");
  } catch (e) {
    console.log("   ℹ️ No explicit button (may auto-submit)");
  }

  await page.waitForTimeout(CFG.waits.search);
  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (e) { /* */ }
  await page.waitForTimeout(3000);
  console.log(`   📍 URL: ${page.url()}`);
}

async function extractPrices(stagehand, page, recorder) {
  console.log(`🎯 STEP 4: Extract ride prices...\n`);
  const { z } = require("zod/v3");

  // Scroll to load
  for (let i = 0; i < 5; i++) {
    await page.evaluate("window.scrollBy(0, 400)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // First try AI extraction
  let results;
  try {
    results = await stagehand.extract(
      `Extract all ride type options with their estimated price ranges. For each ride type, get the ride type name (like UberX, UberXL, Comfort, etc.) and the price or price range (like "$23-$30" or "$25"). Include ALL visible ride options.`,
      z.object({
        rides: z.array(z.object({
          rideType: z.string().describe("Ride type name, e.g. UberX, UberXL, Comfort"),
          priceRange: z.string().describe("Price or price range, e.g. '$23-$30' or '$25.50'"),
        })).describe("All ride options with prices"),
      })
    );
  } catch (e) {
    console.log("   ⚠️ AI extraction failed, trying text fallback");
    results = { rides: [] };
  }

  recorder.record("extract", {
    instruction: "Extract ride prices",
    description: `Extract ride estimates`,
    results,
  });

  if (results.rides.length === 0) {
    // Fallback: text-based extraction
    console.log("   Trying text-based extraction...");
    const bodyText = await page.evaluate("document.body.innerText");
    const lines = bodyText.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (/uber\s*x(?:l)?|comfort|green|black|suv|share|pool|premier|connect/i.test(line)) {
        const contextBlock = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 5)).join(" ");
        const rangeMatch = contextBlock.match(/\$(\d+(?:\.\d{2})?)\s*[-–]\s*\$(\d+(?:\.\d{2})?)/);
        const singleMatch = contextBlock.match(/\$(\d+(?:\.\d{2})?)/);
        if (rangeMatch) {
          results.rides.push({
            rideType: line.substring(0, 30).trim(),
            priceRange: `$${rangeMatch[1]}-$${rangeMatch[2]}`,
          });
        } else if (singleMatch) {
          results.rides.push({
            rideType: line.substring(0, 30).trim(),
            priceRange: `$${singleMatch[1]}`,
          });
        }
      }
    }
  }

  // Log all results
  console.log(`📋 Found ${results.rides.length} ride options:`);
  results.rides.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.rideType}: ${r.priceRange}`);
  });

  // Highlight UberX and UberXL
  console.log("\n📌 Target ride types:");
  for (const target of CFG.rideTypes) {
    const match = results.rides.find(r =>
      r.rideType.toLowerCase().replace(/\s+/g, "") === target.toLowerCase().replace(/\s+/g, "")
    );
    if (match) {
      console.log(`   ✅ ${match.rideType}: ${match.priceRange}`);
    } else {
      console.log(`   ❌ ${target}: not found`);
    }
  }

  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Uber – Ride Price Estimate");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🚗 ${CFG.pickup}`);
  console.log(`  📍 ${CFG.dropoff}\n`);

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");
  let stagehand;

  try {
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: ["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions", "--start-maximized", "--window-size=1920,1080"],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");

    const page = stagehand.context.pages()[0];

    // Navigate
    console.log("🌐 Loading Uber price estimate...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    await dismissPopups(page);
    await enterLocation(stagehand, page, recorder, "pickup", CFG.pickup);
    await enterLocation(stagehand, page, recorder, "dropoff", CFG.dropoff);
    await clickGetEstimate(stagehand, page, recorder);

    const results = await extractPrices(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.rides.length} ride options found`);
    console.log("═══════════════════════════════════════════════════════════");
    results.rides.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.rideType}: ${r.priceRange}`);
    });

    // Save outputs
    fs.writeFileSync(path.join(__dirname, "uber_search.py"), genPython(CFG, recorder), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(
      path.join(__dirname, "recorded_actions.json"),
      JSON.stringify(recorder.actions, null, 2),
      "utf-8"
    );
    console.log("📋 Actions saved");

    return results;

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      fs.writeFileSync(path.join(__dirname, "uber_search.py"), genPython(CFG, recorder), "utf-8");
      console.log("⚠️  Partial Python saved");
    }
    throw err;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing...");
      await stagehand.close();
    }
  }
}

if (require.main === module) {
  main()
    .then(() => { console.log("🎊 Done!"); process.exit(0); })
    .catch((e) => { console.error("💥", e.message); process.exit(1); });
}
module.exports = { main };
