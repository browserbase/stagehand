const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Apartments.com – Apartment Search  (v1 — AI exploration)
 *
 * Searches for apartments in Austin, TX, filters by price $1,000–$2,000/mo,
 * and extracts the top 5 listings with name, address, price, beds/baths.
 *
 * Uses AI-driven discovery (observeAndAct) for navigation steps.
 * stagehand.extract() used for listing data extraction.
 */

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.apartments.com",
  location: "Austin, TX",
  priceMin: 1000,
  priceMax: 2000,
  maxResults: 5,
  waits: { page: 3000, type: 2000, select: 2000, search: 5000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Apartments.com - Apartment Search
Location: ${cfg.location}
Price range: $${cfg.priceMin} - $${cfg.priceMax} / month

Generated on: ${ts}
Recorded ${n} browser interactions

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
    playwright: Playwright,
    location: str = "${cfg.location}",
    price_min: int = ${cfg.priceMin},
    price_max: int = ${cfg.priceMax},
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  Apartments.com - Apartment Search")
    print("=" * 59)
    print(f"  Location:    {location}")
    print("  Price range: $" + format(price_min, ",") + " - $" + format(price_max, ",") + " / month\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("apartments_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Apartments.com...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups / cookie banners ───────────────────────────────
        for selector in [
            "button#onetrust-accept-btn-handler",
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
            "button:has-text('Close')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 1: Enter location ────────────────────────────────────────
        print(f'STEP 1: Location = "{location}"...')

        search_input = page.locator(
            'input#quickSearchLookup, '
            'input[placeholder*="Search"], '
            'input[aria-label*="earch"], '
            'input[type="search"]'
        ).first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.wait_for_timeout(200)
        search_input.type(location, delay=50)
        print(f'  Typed "{location}"')
        page.wait_for_timeout(2000)

        # Select first autocomplete suggestion
        try:
            suggestion = page.locator(
                '#defined-location-list li, '
                '[class*="autocomplete"] li, '
                'li[role="option"]'
            ).first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
            print("  Selected first suggestion")
        except Exception:
            page.keyboard.press("Enter")
            print("  No autocomplete, pressed Enter")
        page.wait_for_timeout(1000)

        # ── STEP 2: Click search ──────────────────────────────────────────
        print("STEP 2: Search...")
        try:
            search_btn = page.locator(
                'button[type="submit"], '
                'button:has-text("Search"), '
                'button[aria-label*="earch"]'
            ).first
            search_btn.evaluate("el => el.click()")
            print("  Clicked Search")
        except Exception:
            page.keyboard.press("Enter")
            print("  Pressed Enter to search")

        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  URL: {page.url}")

        # ── STEP 3: Apply price filter ────────────────────────────────────
        print("STEP 3: Filter price $" + format(price_min, ",") + " - $" + format(price_max, ",") + "...")

        # Apartments.com uses min/max price dropdowns or inputs
        # Try to find and set the minimum price
        try:
            min_input = page.locator(
                'input[name="PriceMin"], '
                'input#TextMinPrice, '
                'input[placeholder*="Min"], '
                'input[aria-label*="in price"], '
                'input[aria-label*="inimum"]'
            ).first
            min_input.evaluate("el => el.click()")
            page.keyboard.press("Control+a")
            min_input.type(str(price_min), delay=50)
            print("  Set min price: $" + format(price_min, ","))
        except Exception:
            print("  Could not find min price input — trying dropdown")
            try:
                # May be a dropdown / select
                min_dd = page.locator(
                    'select[name="PriceMin"], '
                    'select#TextMinPrice'
                ).first
                min_dd.select_option(str(price_min))
                print("  Selected min price: $" + format(price_min, ","))
            except Exception:
                print("  Could not set min price filter")

        page.wait_for_timeout(500)

        # Try to find and set the maximum price
        try:
            max_input = page.locator(
                'input[name="PriceMax"], '
                'input#TextMaxPrice, '
                'input[placeholder*="Max"], '
                'input[aria-label*="ax price"], '
                'input[aria-label*="aximum"]'
            ).first
            max_input.evaluate("el => el.click()")
            page.keyboard.press("Control+a")
            max_input.type(str(price_max), delay=50)
            print("  Set max price: $" + format(price_max, ","))
        except Exception:
            print("  Could not find max price input — trying dropdown")
            try:
                max_dd = page.locator(
                    'select[name="PriceMax"], '
                    'select#TextMaxPrice'
                ).first
                max_dd.select_option(str(price_max))
                print("  Selected max price: $" + format(price_max, ","))
            except Exception:
                print("  Could not set max price filter")

        page.wait_for_timeout(500)

        # Apply the filter (button click, Enter, or auto-apply)
        try:
            apply_btn = page.locator(
                'button:has-text("Apply"), '
                'button:has-text("Done"), '
                'button:has-text("Update"), '
                'button:has-text("Go")'
            ).first
            apply_btn.evaluate("el => el.click()")
            print("  Applied filter")
        except Exception:
            page.keyboard.press("Enter")
            print("  Pressed Enter to apply")

        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  URL: {page.url}")

        # ── STEP 4: Extract listings ──────────────────────────────────────
        print(f"STEP 4: Extract up to {max_results} listings...")

        # Scroll to load more listings
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Extract using property cards
        cards = page.locator(
            '[data-listingid], '
            'article[data-pk], '
            '[class*="placard"], '
            '[class*="PropertyCard"], '
            'li[class*="mortar-wrapper"]'
        )
        count = cards.count()
        print(f"  Found {count} property cards")

        seen_names = set()
        for i in range(count):
            if len(results) >= max_results:
                break
            card = cards.nth(i)
            try:
                # Name
                name = "N/A"
                try:
                    name_el = card.locator(
                        '[class*="property-title"], '
                        '[data-test="property-title"], '
                        'h3, h2, '
                        'a[class*="title"]'
                    ).first
                    name = name_el.inner_text(timeout=3000).strip()
                except Exception:
                    pass

                # Address
                address = "N/A"
                try:
                    addr_el = card.locator(
                        '[class*="property-address"], '
                        '[data-test="property-address"], '
                        'address, '
                        'p[class*="addr"]'
                    ).first
                    address = addr_el.inner_text(timeout=3000).strip()
                except Exception:
                    pass

                # Price
                price = "N/A"
                try:
                    price_el = card.locator(
                        '[class*="property-pricing"], '
                        '[data-test="property-pricing"], '
                        'p[class*="price"], '
                        'span:has-text("$")'
                    ).first
                    price = price_el.inner_text(timeout=3000).strip()
                except Exception:
                    pass

                # Beds / Baths
                beds_baths = "N/A"
                try:
                    bb_el = card.locator(
                        '[class*="property-beds"], '
                        '[data-test="property-beds"], '
                        'p[class*="bed"]'
                    ).first
                    beds_baths = bb_el.inner_text(timeout=3000).strip()
                except Exception:
                    pass

                if name == "N/A" and price == "N/A":
                    continue

                name_key = name.lower().strip()
                if name_key in seen_names:
                    continue
                seen_names.add(name_key)

                results.append({
                    "name": name,
                    "address": address,
                    "price": price,
                    "beds_baths": beds_baths,
                })
            except Exception:
                continue

        # Fallback: text-based extraction
        if not results:
            print("  Card extraction failed, trying text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            lines = body_text.split("\\n")
            for i, line in enumerate(lines):
                if len(results) >= max_results:
                    break
                pm = re.search(r"\\$[\\d,]+", line)
                if pm and len(line.strip()) < 150:
                    name = "N/A"
                    address = "N/A"
                    for j in range(max(0, i - 5), i):
                        candidate = lines[j].strip()
                        if candidate and len(candidate) > 3 and not re.match(r"^\\$", candidate):
                            if name == "N/A":
                                name = candidate
                            elif address == "N/A":
                                address = candidate
                    ctx = " ".join(lines[max(0, i-2):min(len(lines), i+5)])
                    beds_match = re.search(r"(\\d+)\\s*(?:Bed|BR)", ctx, re.IGNORECASE)
                    baths_match = re.search(r"(\\d+)\\s*(?:Bath|BA)", ctx, re.IGNORECASE)
                    beds_baths = ""
                    if beds_match:
                        beds_baths += beds_match.group(1) + " Bed"
                    if baths_match:
                        beds_baths += " " + baths_match.group(1) + " Bath"
                    beds_baths = beds_baths.strip() or "N/A"
                    results.append({
                        "name": name,
                        "address": address,
                        "price": pm.group(0),
                        "beds_baths": beds_baths,
                    })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} listings in '{location}':")
        print("  Price range: $" + format(price_min, ",") + " - $" + format(price_max, ",") + " / month\\n")
        for i, apt in enumerate(results, 1):
            print(f"  {i}. {apt['name']}")
            print(f"     Address:    {apt['address']}")
            print(f"     Price:      {apt['price']}")
            print(f"     Beds/Baths: {apt['beds_baths']}")

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
        print(f"\\nTotal listings: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  try {
    for (let i = 0; i < 3; i++) {
      const clicked = await page.evaluate(`(() => {
        const btns = document.querySelectorAll('button, a, [role="button"]');
        for (const btn of btns) {
          const txt = (btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();
          if (['close','dismiss','accept','got it','ok','no thanks','not now',
               'accept all cookies','accept all','accept cookies'].includes(txt)) {
            if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
              btn.click(); return txt;
            }
          }
        }
        // Also try OneTrust cookie handler
        const ot = document.querySelector('#onetrust-accept-btn-handler');
        if (ot && (ot.offsetParent !== null || ot.getClientRects().length > 0)) {
          ot.click(); return 'onetrust';
        }
        return false;
      })()`);
      if (clicked) {
        console.log(`   ✅ Dismissed: "${clicked}"`);
        await page.waitForTimeout(800);
      } else break;
    }
  } catch (e) { /* ignore */ }
  await page.waitForTimeout(500);
}

async function enterLocation(stagehand, page, recorder, location) {
  console.log(`🎯 STEP 1: Location = "${location}"...`);

  // Use AI to find and click the search input
  await observeAndAct(stagehand, page, recorder,
    `Click the location search input field where I can type an apartment search location`,
    "Click search input"
  );
  await page.waitForTimeout(500);

  // Clear and type
  await page.keyPress("Control+a");
  await page.waitForTimeout(100);
  await page.keyPress("Backspace");
  await page.waitForTimeout(200);
  await page.type(location, { delay: 50 });
  console.log(`   Typed "${location}"`);
  recorder.record("act", {
    instruction: `Type '${location}' into search`,
    description: `Fill location: ${location}`,
    method: "type",
  });
  await page.waitForTimeout(CFG.waits.type);

  // Select first autocomplete suggestion
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the first autocomplete suggestion in the dropdown list that matches "${location}" or "Austin, TX"`,
      "Select location suggestion",
      CFG.waits.select
    );
    console.log("   ✅ Selected suggestion");
  } catch (e) {
    console.log("   ⚠️  No autocomplete suggestion, continuing");
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function clickSearch(stagehand, page, recorder) {
  console.log("🎯 STEP 2: Search...");

  await observeAndAct(stagehand, page, recorder,
    `Click the Search button to search for apartments`,
    "Click Search button"
  );
  console.log("   ✅ Clicked Search");

  await page.waitForTimeout(CFG.waits.search);
  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (e) { /* */ }
  await page.waitForTimeout(3000);
  console.log(`   📍 URL: ${page.url()}`);
}

async function applyPriceFilter(stagehand, page, recorder, priceMin, priceMax) {
  console.log(`🎯 STEP 3: Price filter $${priceMin.toLocaleString()} - $${priceMax.toLocaleString()}...`);

  // Open the price filter (apartments.com has a filter bar at top of results)
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the Price filter button or dropdown to open price range options`,
      "Open price filter"
    );
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log("   ⚠️  Could not find price filter button");
  }

  // Set minimum price
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the minimum price input field or dropdown and set it to $${priceMin.toLocaleString()}`,
      "Set min price"
    );
    await page.waitForTimeout(500);

    // If it's an input field, we might need to type
    try {
      await stagehand.act(`Select or type ${priceMin} as the minimum price`);
    } catch (e) { /* might already be set */ }
    await page.waitForTimeout(500);
  } catch (e) {
    console.log("   ⚠️  Could not set min price");
  }

  // Set maximum price
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the maximum price input field or dropdown and set it to $${priceMax.toLocaleString()}`,
      "Set max price"
    );
    await page.waitForTimeout(500);

    try {
      await stagehand.act(`Select or type ${priceMax} as the maximum price`);
    } catch (e) { /* might already be set */ }
    await page.waitForTimeout(500);
  } catch (e) {
    console.log("   ⚠️  Could not set max price");
  }

  // Apply the filter if there's an explicit button
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the Apply, Done, or Update button to apply the price filter`,
      "Apply price filter"
    );
    console.log("   ✅ Applied price filter");
  } catch (e) {
    // Some sites auto-apply
    console.log("   ℹ️  No apply button found (may auto-apply)");
  }

  await page.waitForTimeout(CFG.waits.search);
  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (e) { /* */ }
  await page.waitForTimeout(3000);
  console.log(`   📍 URL: ${page.url()}`);
}

async function extractListings(stagehand, page, recorder) {
  console.log(`🎯 STEP 4: Extract up to ${CFG.maxResults} listings...\n`);
  const { z } = require("zod/v3");

  // Scroll to load listings
  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 500)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // AI extraction with zod schema
  let listings;
  try {
    listings = await stagehand.extract(
      `Extract the top ${CFG.maxResults} apartment listings from the search results. For each listing, get the property name, full street address, monthly price or price range (like "$1,200/mo" or "$1,100 - $1,800"), and beds/baths info (like "1-3 Beds", "1 Bed, 1 Bath"). Skip any ads or sponsored content. Only extract real apartment listings that are visible on the page.`,
      z.object({
        apartments: z.array(z.object({
          name: z.string().describe("Property name"),
          address: z.string().describe("Full street address"),
          price: z.string().describe("Monthly price or price range, e.g. '$1,200/mo' or '$1,100 - $1,800'"),
          bedsBaths: z.string().describe("Beds and baths info, e.g. '1-3 Beds, 1-2 Baths'"),
        })).describe(`Top ${CFG.maxResults} apartment listings`),
      })
    );
  } catch (e) {
    console.log("   ⚠️ AI extraction failed, trying text fallback");
    listings = { apartments: [] };
  }

  recorder.record("extract", {
    instruction: "Extract apartment listings",
    description: `Extract up to ${CFG.maxResults} listings`,
    results: listings,
  });

  if (listings.apartments.length === 0) {
    // Fallback: text-based extraction
    console.log("   Trying text-based extraction...");
    const bodyText = await page.evaluate("document.body.innerText");
    const lines = bodyText.split("\n");
    for (let i = 0; i < lines.length && listings.apartments.length < CFG.maxResults; i++) {
      const line = lines[i].trim();
      // Look for price patterns
      const priceMatch = line.match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?/);
      if (priceMatch && line.length < 150) {
        // Look backward for name and address
        let name = "N/A", address = "N/A";
        for (let j = Math.max(0, i - 5); j < i; j++) {
          const candidate = lines[j].trim();
          if (candidate && candidate.length > 3 && !candidate.match(/^\$/)) {
            if (name === "N/A") name = candidate;
            else if (address === "N/A") address = candidate;
          }
        }
        // Look nearby for beds/baths
        const ctx = lines.slice(Math.max(0, i - 2), Math.min(lines.length, i + 5)).join(" ");
        const bbMatch = ctx.match(/(\d+[-–]?\d*)\s*(?:Bed|BR)s?[\s,]*(\d+[-–]?\d*)\s*(?:Bath|BA)s?/i);
        const bedsBaths = bbMatch ? `${bbMatch[1]} Bed, ${bbMatch[2]} Bath` : "N/A";
        listings.apartments.push({ name, address, price: priceMatch[0], bedsBaths });
      }
    }
  }

  // Log results
  console.log(`📋 Found ${listings.apartments.length} listings:`);
  listings.apartments.forEach((apt, i) => {
    console.log(`   ${i + 1}. ${apt.name}`);
    console.log(`      Address:    ${apt.address}`);
    console.log(`      Price:      ${apt.price}`);
    console.log(`      Beds/Baths: ${apt.bedsBaths}`);
  });

  return listings;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Apartments.com – Apartment Search  (v1 — AI exploration)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🏠 ${CFG.location}`);
  console.log(`  💰 $${CFG.priceMin.toLocaleString()} – $${CFG.priceMax.toLocaleString()} / month\n`);

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
    console.log("🌐 Loading Apartments.com...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    // Steps
    await dismissPopups(page);
    await enterLocation(stagehand, page, recorder, CFG.location);
    await clickSearch(stagehand, page, recorder);
    await applyPriceFilter(stagehand, page, recorder, CFG.priceMin, CFG.priceMax);
    const listings = await extractListings(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${listings.apartments.length} listings found`);
    console.log("═══════════════════════════════════════════════════════════");
    listings.apartments.forEach((apt, i) => {
      console.log(`  ${i + 1}. ${apt.name}`);
      console.log(`     ${apt.address}`);
      console.log(`     ${apt.price}  |  ${apt.bedsBaths}`);
    });

    // Save outputs
    fs.writeFileSync(path.join(__dirname, "apartments_search.py"), genPython(CFG, recorder), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(
      path.join(__dirname, "recorded_actions.json"),
      JSON.stringify(recorder.actions, null, 2),
      "utf-8"
    );
    console.log("📋 Actions saved");

    return listings;

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      fs.writeFileSync(path.join(__dirname, "apartments_search.py"), genPython(CFG, recorder), "utf-8");
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
