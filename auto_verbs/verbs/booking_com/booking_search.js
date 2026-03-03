const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Booking.com – Hotel Search
 *
 * Uses AI-driven discovery to interact with Booking.com's hotel search.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Configuration ────────────────────────────────────────────────────────────
function computeDates() {
  const today = new Date();
  const checkin = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const checkout = new Date(checkin);
  checkout.setDate(checkout.getDate() + 2);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const fmtDisplay = (d) => `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  return { checkin: fmt(checkin), checkout: fmt(checkout), checkinDisplay: fmtDisplay(checkin), checkoutDisplay: fmtDisplay(checkout) };
}
const dates = computeDates();

const CFG = {
  url: "https://www.booking.com",
  destination: "Chicago",
  checkin: dates.checkin,
  checkout: dates.checkout,
  checkinDisplay: dates.checkinDisplay,
  checkoutDisplay: dates.checkoutDisplay,
  nights: 2,
  maxResults: 5,
  waits: { page: 3000, type: 2000, select: 1000, search: 5000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Booking.com – Hotel Search
Search: ${cfg.destination}
Check-in: ${cfg.checkinDisplay}  Check-out: ${cfg.checkoutDisplay}  (${cfg.nights} nights)

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import re
import os, sys, shutil
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def compute_dates():
    today = date.today()
    checkin = today + relativedelta(months=2)
    checkout = checkin + timedelta(days=${cfg.nights})
    return checkin, checkout


def run(
    playwright: Playwright,
    destination: str = "${cfg.destination}",
    max_results: int = ${cfg.maxResults},
) -> list:
    checkin, checkout = compute_dates()
    checkin_str = checkin.strftime("%Y-%m-%d")
    checkout_str = checkout.strftime("%Y-%m-%d")
    checkin_display = checkin.strftime("%m/%d/%Y")
    checkout_display = checkout.strftime("%m/%d/%Y")

    print(f"  Destination: {destination}")
    print(f"  Check-in: {checkin_display}  Check-out: {checkout_display}  (${cfg.nights} nights)\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("booking_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    seen_names = set()

    try:
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Booking.com...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups / cookie banners ───────────────────────────────
        for selector in [
            "button#onetrust-accept-btn-handler",
            "[aria-label='Dismiss sign-in info.']",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 1: Enter destination ─────────────────────────────────────
        print(f'STEP 1: Destination = "{destination}"...')

        # Booking.com search input
        search_input = page.locator(
            '[data-testid="destination-container"] input, '
            'input[name="ss"], '
            'input[placeholder*="Where are you going"]'
        ).first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        search_input.fill("")
        search_input.type(destination, delay=50)
        print(f'  Typed "{destination}"')
        page.wait_for_timeout(2000)

        # Select first autocomplete suggestion
        try:
            suggestion = page.locator(
                '[data-testid="autocomplete-result"], '
                'li[role="option"], '
                '[class*="autocomplete"] li'
            ).first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
            print("  Selected first suggestion")
        except Exception:
            page.keyboard.press("Enter")
            print("  No autocomplete suggestion, pressed Enter")
        page.wait_for_timeout(1000)

        # ── STEP 2: Set dates ─────────────────────────────────────────────
        print(f"STEP 2: Dates — Check-in: {checkin_display}, Check-out: {checkout_display}...")

        # Click check-in date in the calendar
        # Booking.com uses data-date attributes on calendar cells
        checkin_cell = page.locator(f'[data-date="{checkin_str}"]').first
        try:
            checkin_cell.wait_for(state="visible", timeout=5000)
            checkin_cell.evaluate("el => el.click()")
            print(f"  Clicked check-in date: {checkin_str}")
        except Exception:
            # Calendar might not be open yet — try clicking the date field first
            print("  Calendar not visible, clicking date field...")
            date_field = page.locator(
                '[data-testid="date-display-field-start"], '
                '[data-testid="searchbox-dates-container"], '
                'button[data-testid="date-display-field-start"]'
            ).first
            date_field.evaluate("el => el.click()")
            page.wait_for_timeout(1000)

            # Navigate calendar months (forward or backward) to find the target date
            for _ in range(6):
                try:
                    checkin_cell = page.locator(f'[data-date="{checkin_str}"]').first
                    if checkin_cell.is_visible(timeout=1000):
                        break
                except Exception:
                    pass
                # Determine direction by comparing visible months to target
                target_ym = checkin_str[:7]  # "YYYY-MM"
                visible_dates = page.eval_on_selector_all(
                    '[data-date]',
                    'els => els.map(e => e.getAttribute("data-date")).sort()'
                )
                if visible_dates and target_ym < visible_dates[0][:7]:
                    # Target is before visible months → go backward
                    try:
                        page.locator('button[aria-label="Previous month"]').first.evaluate("el => el.click()")
                        page.wait_for_timeout(500)
                    except Exception:
                        break
                else:
                    # Target is after visible months → go forward
                    try:
                        page.locator('button[aria-label="Next month"]').last.evaluate("el => el.click()")
                        page.wait_for_timeout(500)
                    except Exception:
                        break

            checkin_cell = page.locator(f'[data-date="{checkin_str}"]').first
            checkin_cell.evaluate("el => el.click()")
            print(f"  Clicked check-in date: {checkin_str}")
        page.wait_for_timeout(500)

        # Click checkout date
        checkout_cell = page.locator(f'[data-date="{checkout_str}"]').first
        try:
            checkout_cell.wait_for(state="visible", timeout=3000)
            checkout_cell.evaluate("el => el.click()")
            print(f"  Clicked check-out date: {checkout_str}")
        except Exception:
            # May need to navigate forward or backward
            for _ in range(3):
                try:
                    checkout_cell = page.locator(f'[data-date="{checkout_str}"]').first
                    if checkout_cell.is_visible(timeout=1000):
                        checkout_cell.evaluate("el => el.click()")
                        print(f"  Clicked check-out date: {checkout_str}")
                        break
                except Exception:
                    pass
                target_ym = checkout_str[:7]
                visible_dates = page.eval_on_selector_all(
                    '[data-date]',
                    'els => els.map(e => e.getAttribute("data-date")).sort()'
                )
                if visible_dates and target_ym < visible_dates[0][:7]:
                    try:
                        page.locator('button[aria-label="Previous month"]').first.evaluate("el => el.click()")
                        page.wait_for_timeout(500)
                    except Exception:
                        break
                else:
                    try:
                        page.locator('button[aria-label="Next month"]').last.evaluate("el => el.click()")
                        page.wait_for_timeout(500)
                    except Exception:
                        break
        page.wait_for_timeout(500)

        # ── STEP 3: Click Search ──────────────────────────────────────────
        print("STEP 3: Search...")
        search_btn = page.locator(
            'button[type="submit"], '
            '[data-testid="searchbox-search-button"], '
            'button:has-text("Search")'
        ).first
        search_btn.evaluate("el => el.click()")
        print("  Clicked Search button")

        # Wait for results
        try:
            page.wait_for_url("**/searchresults**", timeout=15000)
            print(f"  Navigated to: {page.url}")
        except Exception:
            print(f"  URL after wait: {page.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # ── STEP 4: Extract hotels ────────────────────────────────────────
        print(f"STEP 4: Extract up to {max_results} hotels...")

        # Booking.com property cards
        hotel_cards = page.locator(
            '[data-testid="property-card"], '
            '[data-testid="property-card-container"], '
            '[class*="PropertyCard"], '
            '[class*="sr_property_block"]'
        )
        count = hotel_cards.count()
        print(f"  Found {count} hotel cards")

        for i in range(count):
            if len(results) >= max_results:
                break
            card = hotel_cards.nth(i)
            try:
                # Extract hotel name
                name = "N/A"
                try:
                    name_el = card.locator(
                        '[data-testid="title"], '
                        '[class*="title"], '
                        'h3, h4, '
                        'a[data-testid="title-link"]'
                    ).first
                    name = name_el.inner_text(timeout=3000).strip()
                    # Clean up trailing "Opens in new window" etc.
                    name = re.sub(r'\\s*Opens in new window\\s*$', '', name).strip()
                except Exception:
                    pass

                # Extract price
                price = "N/A"
                try:
                    price_el = card.locator(
                        '[data-testid="price-and-discounted-price"], '
                        '[class*="price"], '
                        'span:has-text("$")'
                    ).first
                    price_text = price_el.inner_text(timeout=3000).strip()
                    pm = re.search(r"\\$[\\d,]+", price_text)
                    if pm:
                        price = pm.group(0)
                except Exception:
                    # Fallback: search all card text for price
                    try:
                        card_text = card.inner_text(timeout=3000)
                        pm = re.search(r"\\$[\\d,]+", card_text)
                        if pm:
                            price = pm.group(0)
                    except Exception:
                        pass

                if name == "N/A" and price == "N/A":
                    continue

                # Deduplicate by hotel name
                name_key = name.lower().strip()
                if name_key in seen_names:
                    continue
                seen_names.add(name_key)

                # Compute per-night price
                per_night = price
                if price != "N/A":
                    raw = int(price.replace("$", "").replace(",", ""))
                    per_night_val = raw // ${cfg.nights}
                    per_night = f"\${per_night_val:,}"

                results.append({
                    "name": name,
                    "total_price": price,
                    "per_night_price": per_night,
                })
            except Exception:
                continue

        # Fallback: regex on page text
        if not results:
            print("  Card extraction failed, trying text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            # Look for patterns like hotel name followed by price
            lines = body_text.split("\\n")
            for i, line in enumerate(lines):
                if len(results) >= max_results:
                    break
                pm = re.search(r"\\$[\\d,]+", line)
                if pm and len(line.strip()) < 200:
                    # Look backward for hotel name
                    name = "N/A"
                    for j in range(max(0, i - 5), i):
                        candidate = lines[j].strip()
                        if candidate and len(candidate) > 5 and not re.match(r"^\\$", candidate):
                            name = candidate
                    if name != "N/A":
                        total = pm.group(0)
                        raw = int(total.replace("$", "").replace(",", ""))
                        per_night = f"\${raw // ${cfg.nights}:,}"
                        results.append({
                            "name": name,
                            "total_price": total,
                            "per_night_price": per_night,
                        })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} hotels in '{destination}':")
        print(f"  Check-in: {checkin_display}  Check-out: {checkout_display}  (${cfg.nights} nights)\\n")
        for i, hotel in enumerate(results, 1):
            print(f"  {i}. {hotel['name']}")
            print(f"     Per-night Price: {hotel['per_night_price']}  (Total: {hotel['total_price']})")

    except Exception as e:
        import traceback
        print(f"Error: {e}")
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
        print(f"\\nTotal hotels found: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  try {
    // Cookie consent
    const cookieBtn = page.locator("button#onetrust-accept-btn-handler");
    if (await cookieBtn.isVisible({ timeout: 2000 })) {
      await cookieBtn.click();
      console.log("   ✅ Accepted cookies");
    }
  } catch (e) { /* no cookie banner */ }

  try {
    // Sign-in dismiss
    const dismissBtn = page.locator("[aria-label='Dismiss sign-in info.']");
    if (await dismissBtn.isVisible({ timeout: 1000 })) {
      await dismissBtn.click();
      console.log("   ✅ Dismissed sign-in prompt");
    }
  } catch (e) { /* no sign-in prompt */ }

  await page.waitForTimeout(500);
}

async function enterDestination(stagehand, page, recorder, destination) {
  console.log(`🎯 STEP 1: Destination = "${destination}"...`);

  await observeAndAct(stagehand, page, recorder,
    `Click the destination search input field`,
    "Click destination input"
  );
  await page.waitForTimeout(500);

  await stagehand.act(`Clear the search input field and type '${destination}'`);
  console.log(`   ✅ Typed "${destination}"`);
  recorder.record("act", { instruction: `Type '${destination}' into search`, description: `Fill destination: ${destination}`, method: "type" });

  await page.waitForTimeout(CFG.waits.type);

  // Select first autocomplete suggestion
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the autocomplete suggestion that represents the city of ${destination} (prefer the city option, not an airport)`,
      "Select destination autocomplete suggestion",
      CFG.waits.select
    );
    console.log("   ✅ Selected suggestion");
  } catch (e) {
    console.log("   ⚠️  No autocomplete suggestion found, continuing...");
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function setDates(stagehand, page, recorder, checkin, checkout) {
  console.log(`🎯 STEP 2: Dates — Check-in: ${checkin}, Check-out: ${checkout}...`);

  // Open calendar if needed
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the check-in date field to open the calendar`,
      "Open calendar"
    );
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log("   Calendar may already be open");
  }

  // Navigate to the correct month (forward or backward), then click the date
  // Use page.evaluate() for precise date selection via data-date attributes
  async function clickCalendarDate(dateStr) {
    for (let attempt = 0; attempt < 8; attempt++) {
      // Try clicking the target date cell
      const found = await page.evaluate((ds) => {
        const cell = document.querySelector(`[data-date="${ds}"]`);
        if (cell) { cell.click(); return true; }
        return false;
      }, dateStr);
      if (found) return true;

      // Determine direction: compare visible calendar month(s) to target
      const direction = await page.evaluate((ds) => {
        const targetYM = ds.substring(0, 7); // "YYYY-MM"
        // Booking.com renders visible date cells with data-date
        const allCells = document.querySelectorAll('[data-date]');
        if (allCells.length === 0) return 'next';
        const visibleDates = Array.from(allCells).map(c => c.getAttribute('data-date')).sort();
        const firstYM = visibleDates[0].substring(0, 7);
        const lastYM = visibleDates[visibleDates.length - 1].substring(0, 7);
        if (targetYM < firstYM) return 'prev';
        return 'next';
      }, dateStr);

      try {
        if (direction === 'prev') {
          await stagehand.act("Click the previous month arrow button in the calendar to go back one month");
        } else {
          await stagehand.act("Click the next month arrow button in the calendar to go forward one month");
        }
        await page.waitForTimeout(500);
      } catch (e2) { break; }
    }
    return false;
  }

  if (await clickCalendarDate(checkin)) {
    console.log(`   ✅ Selected check-in: ${checkin}`);
  } else {
    console.log(`   ⚠️  Could not find check-in date cell: ${checkin}`);
  }
  recorder.record("act", { instruction: `Select check-in date ${checkin}`, description: "Click check-in date", method: "click" });
  await page.waitForTimeout(500);

  // Click checkout date (should be visible now since it's close to check-in)
  if (await clickCalendarDate(checkout)) {
    console.log(`   ✅ Selected check-out: ${checkout}`);
  } else {
    console.log(`   ⚠️  Could not find check-out date cell: ${checkout}`);
  }
  recorder.record("act", { instruction: `Select check-out date ${checkout}`, description: "Click check-out date", method: "click" });
  await page.waitForTimeout(500);
}

async function clickSearch(stagehand, page, recorder) {
  console.log("🎯 STEP 3: Search...");

  await observeAndAct(stagehand, page, recorder,
    `Click the Search button to search for hotels`,
    "Click Search button"
  );
  console.log("   ✅ Clicked Search button");

  // Wait for results
  await page.waitForTimeout(CFG.waits.search);
  try {
    await page.waitForURL("**/searchresults**", { timeout: 15000 });
    console.log(`   📍 URL: ${page.url()}`);
  } catch (e) {
    console.log(`   📍 URL after wait: ${page.url()}`);
  }
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(CFG.waits.search);
}

async function extractHotels(stagehand, page, recorder) {
  console.log(`🎯 STEP 4: Extract up to ${CFG.maxResults} hotels...\n`);
  const { z } = require("zod/v3");

  const listings = await stagehand.extract(
    `Extract up to ${CFG.maxResults} hotel search results. For each hotel, get the hotel name and the numeric total price (just the dollar amount like '$152', not 'Price $152'). Only real hotel listings, not ads or promotions. If there is an original price and a current price, use the current price.`,
    z.object({
      hotels: z.array(z.object({
        name: z.string().describe("Hotel name"),
        totalPrice: z.string().describe("Numeric total price, e.g. '$152'"),
      })).describe(`Up to ${CFG.maxResults} hotels`),
    })
  );

  recorder.record("extract", {
    instruction: "Extract hotel search results",
    description: `Extract up to ${CFG.maxResults} hotels`,
    results: listings,
  });

  // Parse prices robustly (handle "Price $197", "$197", "Original price $172. Current price $155.")
  function parsePrice(priceStr) {
    const matches = priceStr.match(/\$(\d[\d,]*)/g);
    if (!matches || matches.length === 0) return 0;
    // Use the last $ amount (current price if multiple)
    const last = matches[matches.length - 1];
    return parseInt(last.replace(/[$,]/g, "")) || 0;
  }

  console.log(`📋 Found ${listings.hotels.length} hotels:`);
  listings.hotels.forEach((h, i) => {
    const raw = parsePrice(h.totalPrice);
    const perNight = raw > 0 ? `$${Math.floor(raw / CFG.nights)}` : "N/A";
    h.perNightPrice = perNight;
    h.rawTotal = raw;
    console.log(`   ${i + 1}. ${h.name}`);
    console.log(`      💰 Total: $${raw}  Per-night: ${perNight}`);
  });

  return listings;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Booking.com – Hotel Search");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🏨 ${CFG.destination}`);
  console.log(`  📅 Check-in: ${CFG.checkinDisplay}  Check-out: ${CFG.checkoutDisplay}  (${CFG.nights} nights)\n`);

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
    console.log("🌐 Loading Booking.com...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    await dismissPopups(page);
    await enterDestination(stagehand, page, recorder, CFG.destination);
    await setDates(stagehand, page, recorder, CFG.checkin, CFG.checkout);
    await clickSearch(stagehand, page, recorder);

    const listings = await extractHotels(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${listings.hotels.length} hotels found`);
    console.log("═══════════════════════════════════════════════════════════");
    listings.hotels.forEach((h, i) => {
      console.log(`  ${i + 1}. ${h.name} — Per-night: ${h.perNightPrice}  (Total: $${h.rawTotal})`);
    });

    // Save Python + JSON
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "booking_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python: ${pyPath}`);

    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions: ${jsonPath}`);

    return listings;

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder);
      fs.writeFileSync(path.join(__dirname, "booking_search.py"), pyScript, "utf-8");
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
  main().then(() => { console.log("🎊 Done!"); process.exit(0); }).catch((e) => { console.error("💥", e.message); process.exit(1); });
}
module.exports = { main };
