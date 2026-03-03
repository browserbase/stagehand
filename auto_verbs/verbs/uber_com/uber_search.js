const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Uber – Ride Price Estimate  (v2 — concretized)
 *
 * Gets a ride price estimate from Seattle-Tacoma International Airport
 * to Downtown Seattle. Extracts all ride type prices including UberX and UberXL.
 *
 * All DOM interactions are concretized using ARIA selectors discovered
 * from a successful v1 AI-exploration run.  Zero AI calls for navigation.
 * The only AI call is stagehand.extract() for price extraction.
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

// ── Concrete selectors (discovered from v1 AI-exploration run) ──────────────
const SEL = {
  // Pickup & dropoff inputs identified by aria-label
  pickupInput:   'input[aria-label="Pickup location"]',
  dropoffInput:  'input[aria-label="Dropoff location"]',
  // Autocomplete dropdown containers (aria-label on parent div, listbox inside)
  pickupDropdown:  '[aria-label="pickup location dropdown"]',
  dropoffDropdown: '[aria-label="destination location dropdown"]',
  // Autocomplete option items
  autocompleteOption: 'li[role="option"]',
  // "See prices" link/button
  seePrices: 'a[aria-label="See prices"]',
};

// ── genPython (inline) ──────────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)  —  concretized v2
Uber - Ride Price Estimate
Pickup:  ${cfg.pickup}
Dropoff: ${cfg.dropoff}

Generated on: ${ts}
Recorded ${n} browser interactions

All DOM interactions use ARIA-based selectors.
Uses Playwright's native locator API with the user's Chrome profile.
"""

import re
import json
import os, sys, shutil
import traceback
from playwright.sync_api import Playwright, sync_playwright, TimeoutError as PwTimeout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright,
    pickup: str = "${cfg.pickup}",
    dropoff: str = "${cfg.dropoff}",
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  Uber - Ride Price Estimate (concretized v2)")
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

        # Dismiss popups / cookie banners
        for selector in [
            "button:has-text('Accept')",
            "button:has-text('Accept All Cookies')",
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

        # ── STEP 1: Enter pickup location ─────────────────────────────────
        print(f'STEP 1: Pickup = "{pickup}"...')
        pickup_input = page.locator('input[aria-label="Pickup location"]').first
        pickup_input.wait_for(state="visible", timeout=5000)
        pickup_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        pickup_input.type(pickup, delay=50)
        page.wait_for_timeout(3000)

        # Select first autocomplete suggestion from pickup dropdown
        pickup_dd = page.locator('[aria-label="pickup location dropdown"] li[role="option"]').first
        pickup_dd.wait_for(state="visible", timeout=5000)
        pickup_dd.evaluate("el => el.click()")
        print("  Selected pickup suggestion")
        page.wait_for_timeout(2000)

        # ── STEP 2: Enter dropoff location ────────────────────────────────
        print(f'STEP 2: Dropoff = "{dropoff}"...')
        dropoff_input = page.locator('input[aria-label="Dropoff location"]').first
        dropoff_input.wait_for(state="visible", timeout=5000)
        dropoff_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        dropoff_input.type(dropoff, delay=50)
        page.wait_for_timeout(3000)

        # Select autocomplete suggestion from destination dropdown
        dropoff_dd = page.locator('[aria-label="destination location dropdown"] li[role="option"]').first
        dropoff_dd.wait_for(state="visible", timeout=5000)
        dropoff_dd.evaluate("el => el.click()")
        print("  Selected dropoff suggestion")
        page.wait_for_timeout(2000)

        # ── STEP 3: Click "See prices" ────────────────────────────────────
        print("STEP 3: Get price estimate...")
        see_prices = page.locator('a[aria-label="See prices"]').first
        see_prices.wait_for(state="visible", timeout=5000)
        see_prices.evaluate("el => el.click()")
        print("  Clicked 'See prices'")
        page.wait_for_timeout(8000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        print(f"  URL: {page.url}")

        # ── STEP 4: Extract price estimates ───────────────────────────────
        print(f"STEP 4: Extract ride prices...\\n")

        # Scroll to load all ride options
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 400)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        body_text = page.evaluate("document.body.innerText")
        lines = body_text.split("\\n")

        # Known ride types to search for
        known_rides = [
            "UberX", "UberXL", "Comfort", "Comfort Electric",
            "Electric", "Pet", "UberXXL", "Black", "Black SUV", "WAV",
            "Green", "Share", "Pool", "Premier", "Connect",
        ]
        # Uber appends capacity digits to ride names in innerText,
        # e.g. "UberX4", "UberXL6", "Black SUV6", "WAV4".
        # Match ride type name followed by optional digits at end of string.
        for rt in known_rides:
            # Build regex: exact ride name + optional digits + end
            rt_pattern = re.compile(r"^" + re.escape(rt) + r"\\d*$", re.IGNORECASE)
            for i, line in enumerate(lines):
                stripped = line.strip()
                if rt_pattern.match(stripped):
                    # Look nearby for price pattern
                    ctx = " ".join(lines[max(0, i-2):min(len(lines), i+8)])
                    # Try range like $23-$30
                    price_match = re.search(r"\\$(\\d+(?:\\.\\d{2})?)\\s*[-\\u2013]\\s*\\$(\\d+(?:\\.\\d{2})?)", ctx)
                    if not price_match:
                        # Try single price like $25.50
                        price_match = re.search(r"\\$(\\d+(?:\\.\\d{2})?)", ctx)
                    if price_match:
                        if price_match.lastindex and price_match.lastindex == 2:
                            price_range = "$" + str(price_match.group(1)) + "-$" + str(price_match.group(2))
                        else:
                            price_range = "$" + str(price_match.group(1))
                        if not any(r["rideType"] == rt for r in results):
                            results.append({"rideType": rt, "priceRange": price_range})
                        break
                    # Check for non-price entries like "Local Rates"
                    if "local rate" in ctx.lower() or "unavailable" in ctx.lower():
                        if not any(r["rideType"] == rt for r in results):
                            results.append({"rideType": rt, "priceRange": "Local Rates"})
                        break

        print(f"Found {len(results)} ride estimates:")
        for r in results:
            print(f"  {r['rideType']}: {r['priceRange']}")

        # Highlight target ride types
        ride_types = ${JSON.stringify(cfg.rideTypes)}
        print("\\nTarget ride types:")
        for target in ride_types:
            match = next((r for r in results if r["rideType"].lower().replace(" ", "") == target.lower().replace(" ", "")), None)
            if match:
                print(f"  OK  {match['rideType']}: {match['priceRange']}")
            else:
                print(f"  MISS  {target}: not found")

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

// ── Concretized Step Functions (zero AI calls for navigation) ────────────────

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

/**
 * Enter a location (pickup or dropoff) using concretized ARIA selectors.
 * No AI calls — uses page.evaluate() with selectors discovered in v1.
 */
async function enterLocation(page, recorder, locationType, locationText) {
  const label = locationType === "pickup" ? "Pickup" : "Dropoff";
  const stepNum = locationType === "pickup" ? 1 : 2;
  console.log(`🎯 STEP ${stepNum}: ${label} = "${locationText}"...`);

  const ariaLabel = locationType === "pickup" ? "Pickup location" : "Dropoff location";
  const dropdownAriaLabel = locationType === "pickup"
    ? "pickup location dropdown"
    : "destination location dropdown";

  // Click the input field via evaluate
  const clicked = await page.evaluate(`(() => {
    const inp = document.querySelector('input[aria-label="${ariaLabel}"]');
    if (inp) { inp.focus(); inp.click(); return true; }
    return false;
  })()`);
  if (!clicked) throw new Error(`Could not find ${label} input (aria-label="${ariaLabel}")`);
  recorder.record("act", {
    instruction: `Click the ${locationType} location input field`,
    description: `Click ${label} input`,
    selector: `input[aria-label="${ariaLabel}"]`,
    method: "click",
  });
  recorder.wait(500, `Wait after: Click ${label} input`);
  await page.waitForTimeout(500);

  // Clear and type location text
  await page.keyPress("Control+a");
  await page.waitForTimeout(100);
  await page.keyPress("Backspace");
  await page.waitForTimeout(200);
  await page.type(locationText, { delay: 50 });
  console.log(`   Typed "${locationText}"`);
  recorder.record("act", {
    instruction: `Type '${locationText}' into ${label}`,
    description: `Fill ${label}: ${locationText}`,
    method: "type",
  });
  await page.waitForTimeout(CFG.waits.type);

  // Wait for autocomplete dropdown then click first option
  // Poll for up to 5 seconds for an option to appear
  let selected = false;
  for (let attempt = 0; attempt < 10; attempt++) {
    selected = await page.evaluate(`(() => {
      const dd = document.querySelector('[aria-label="${dropdownAriaLabel}"]');
      if (!dd) return false;
      const opt = dd.querySelector('li[role="option"]');
      if (opt) { opt.click(); return true; }
      return false;
    })()`);
    if (selected) break;
    await page.waitForTimeout(500);
  }
  if (!selected) throw new Error(`No autocomplete suggestion appeared for ${label}`);
  console.log(`   ✅ Selected ${label} suggestion`);
  recorder.record("act", {
    instruction: `Click the first autocomplete suggestion that matches "${locationText}"`,
    description: `Select ${label} suggestion`,
    selector: `[aria-label="${dropdownAriaLabel}"] li[role="option"]`,
    method: "click",
  });
  recorder.wait(CFG.waits.select, `Wait after: Select ${label} suggestion`);
  await page.waitForTimeout(CFG.waits.select);
}

/**
 * Click the "See prices" button. Concretized — no AI calls.
 * Uses page.evaluate() to find and click the link by aria-label.
 */
async function clickGetEstimate(page, recorder) {
  console.log("🎯 STEP 3: Get price estimate...");

  const clicked = await page.evaluate(`(() => {
    // Try aria-label first
    let btn = document.querySelector('a[aria-label="See prices"]');
    if (btn) { btn.click(); return "See prices (aria)"; }
    // Fallback: any link/button with matching text
    const els = document.querySelectorAll('a, button');
    for (const el of els) {
      const txt = (el.textContent || '').trim().toLowerCase();
      if (txt === 'see prices' || txt.includes('see price') || txt.includes('get estimate')) {
        el.click(); return txt;
      }
    }
    return false;
  })()`);
  if (!clicked) throw new Error('Could not find "See prices" button');
  console.log(`   ✅ Clicked '${clicked}'`);
  recorder.record("act", {
    instruction: "Click the button to see prices or get an estimate",
    description: "Click estimate button",
    selector: SEL.seePrices,
    method: "click",
  });
  recorder.wait(1000, "Wait after: Click estimate button");

  await page.waitForTimeout(CFG.waits.search);
  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (e) { /* */ }
  await page.waitForTimeout(3000);
  console.log(`   📍 URL: ${page.url()}`);
}

/**
 * Extract ride prices. Uses stagehand.extract() (AI) with zod schema,
 * with a text-based regex fallback.
 */
async function extractPrices(stagehand, page, recorder) {
  console.log(`🎯 STEP 4: Extract ride prices...\n`);
  const { z } = require("zod/v3");

  // Scroll to load all ride options
  for (let i = 0; i < 5; i++) {
    await page.evaluate("window.scrollBy(0, 400)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // AI extraction (the one remaining AI call — ride card DOM is complex)
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
    description: "Extract ride estimates",
    results,
  });

  if (results.rides.length === 0) {
    // Fallback: regex-based text extraction from page body
    console.log("   Trying text-based extraction...");
    const bodyText = await page.evaluate("document.body.innerText");
    const lines = bodyText.split("\n");
    const knownRides = [
      "UberX", "UberXL", "Comfort", "Comfort Electric",
      "Electric", "Pet", "UberXXL", "Black", "Black SUV", "WAV",
      "Green", "Share", "Pool", "Premier", "Connect",
    ];
    for (const rt of knownRides) {
      // Uber appends capacity digits: "UberX4", "UberXL6", "Black SUV6"
      const rtPattern = new RegExp("^" + rt.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\d*$", "i");
      for (let i = 0; i < lines.length; i++) {
        const stripped = lines[i].trim();
        if (rtPattern.test(stripped)) {
          const ctx = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 8)).join(" ");
          const rangeMatch = ctx.match(/\$(\d+(?:\.\d{2})?)\s*[-–]\s*\$(\d+(?:\.\d{2})?)/);
          const singleMatch = ctx.match(/\$(\d+(?:\.\d{2})?)/);
          if (rangeMatch) {
            results.rides.push({ rideType: rt, priceRange: `$${rangeMatch[1]}-$${rangeMatch[2]}` });
          } else if (singleMatch) {
            results.rides.push({ rideType: rt, priceRange: `$${singleMatch[1]}` });
          }
          break;
        }
      }
    }
  }

  // Log all results
  console.log(`📋 Found ${results.rides.length} ride options:`);
  results.rides.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.rideType}: ${r.priceRange}`);
  });

  // Highlight target ride types
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
  console.log("  Uber – Ride Price Estimate  (concretized v2)");
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

    // Steps 1-3: Concretized (zero AI calls)
    await dismissPopups(page);
    await enterLocation(page, recorder, "pickup", CFG.pickup);
    await enterLocation(page, recorder, "dropoff", CFG.dropoff);
    await clickGetEstimate(page, recorder);

    // Step 4: Extract ride prices (uses AI extraction for price cards)
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
