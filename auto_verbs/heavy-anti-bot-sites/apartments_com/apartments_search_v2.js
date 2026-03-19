const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Apartments.com – Apartment Search  (v2 — concretized)
 *
 * Searches for apartments in Austin, TX, filters by price $1,000–$2,000/mo,
 * and extracts the top 5 listings with name, address, price, beds/baths.
 *
 * All DOM interactions concretized using selectors discovered from v1 + probe.
 * Price filter uses observe+act pattern (AI click ensures proper Chromium focus).
 * stagehand.extract() for listing data extraction.
 *
 * Key selectors discovered:
 *   Price link:    #rentRangeLink  (opens price dropdown)
 *   Min input:     #min-input  (type=tel, placeholder "Min Price")
 *   Max input:     #max-input  (type=tel, placeholder "Max Price")
 *   Done button:   .done-btn   (applies filter)
 *
 * Navigation uses the homepage search bar (observe+act) so any
 * free-form location string works — no URL slug needed.
 */

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.apartments.com",
  location: "Austin, TX",
  priceMin: 1000,
  priceMax: 2000,
  maxResults: 5,
  waits: { page: 5000, type: 2000, select: 2000, search: 5000 },
};

// ── Concrete selectors (discovered from v1 AI-exploration + DOM probe) ──────
const SEL = {
  // Price filter (on results page)
  priceLink:     "#rentRangeLink",
  minInput:      "#min-input",
  maxInput:      "#max-input",
  doneBtn:       ".done-btn",
  // Search bar on results page
  searchBarInput: "#quickSearchLookup",
  searchBtn:      '#searchBar button[type="submit"], #srp-smart-search button',
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)  —  concretized v2
Apartments.com - Apartment Search
Location: ${cfg.location}
Price range: $${cfg.priceMin} - $${cfg.priceMax} / month

Generated on: ${ts}
Recorded ${n} browser interactions

Uses homepage search bar for location (works with any free-form location).
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
    print("  Apartments.com - Apartment Search (concretized v2)")
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
        # ── Navigate to homepage ──────────────────────────────────────────
        print("Loading https://www.apartments.com ...")
        page.goto("https://www.apartments.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups / cookie banners ───────────────────────────────
        for selector in [
            "button#onetrust-accept-btn-handler",
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Got it')",
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

        # ── STEP 0: Search for location ───────────────────────────────────
        print(f"STEP 0: Search for '{location}'...")
        # The homepage uses a custom div.smart-search-input widget.
        # Click the search area, then look for a real input to type into.
        search_area = page.locator(".smart-search-input, #heroSearchInput, #quickSearchLookup, input[type='search'], input[placeholder*='search' i]").first
        try:
            search_area.wait_for(state="visible", timeout=5000)
            search_area.evaluate("el => el.click()")
            page.wait_for_timeout(1000)
        except Exception:
            # Fallback: just click the center of the hero section
            page.locator("section").first.evaluate("el => el.click()")
            page.wait_for_timeout(1000)
        # After clicking, check if a standard input appeared
        search_input = None
        for sel in ["input[type='text']:visible", "input[type='search']:visible", "input:not([type]):visible", "#quickSearchLookup", "#heroSearchInput"]:
            try:
                candidate = page.locator(sel).first
                if candidate.is_visible(timeout=2000):
                    search_input = candidate
                    break
            except Exception:
                pass
        if search_input:
            search_input.evaluate("el => el.click()")
            page.keyboard.press("Control+a")
            page.keyboard.press("Backspace")
            search_input.type(location, delay=80)
        else:
            # Type directly — the active element may accept keystrokes
            page.keyboard.type(location, delay=80)
        page.wait_for_timeout(2500)  # wait for autocomplete
        # Try clicking first autocomplete suggestion
        suggestion_clicked = False
        for sel in [".autocompleteList li", "[role='option']", "[role='listbox'] li"]:
            try:
                sug = page.locator(sel).first
                if sug.is_visible(timeout=1500):
                    sug.evaluate("el => el.click()")
                    suggestion_clicked = True
                    print(f"  Clicked autocomplete suggestion")
                    break
            except Exception:
                pass
        if not suggestion_clicked:
            page.keyboard.press("Enter")
            print("  Pressed Enter to search")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Searched. URL: {page.url}")

        # ── STEP 1: Open price filter dropdown ────────────────────────────
        print("STEP 1: Open price filter...")
        price_link = page.locator("#rentRangeLink").first
        price_link.wait_for(state="visible", timeout=5000)
        price_link.evaluate("el => el.click()")
        page.wait_for_timeout(1000)
        print("  Opened price dropdown")

        # ── STEP 2: Set minimum price ─────────────────────────────────────
        print("STEP 2: Set min price = $" + format(price_min, ",") + "...")
        min_input = page.locator("#min-input").first
        min_input.wait_for(state="visible", timeout=3000)
        min_input.evaluate("el => el.click()")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        min_input.type(str(price_min), delay=50)
        page.wait_for_timeout(500)
        print(f"  Typed {price_min}")

        # ── STEP 3: Set maximum price ─────────────────────────────────────
        print("STEP 3: Set max price = $" + format(price_max, ",") + "...")
        max_input = page.locator("#max-input").first
        max_input.wait_for(state="visible", timeout=3000)
        max_input.evaluate("el => el.click()")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        max_input.type(str(price_max), delay=50)
        page.wait_for_timeout(500)
        print(f"  Typed {price_max}")

        # ── STEP 4: Click Done to apply filter ────────────────────────────
        print("STEP 4: Apply filter...")
        done_btn = page.locator(".done-btn").first
        done_btn.evaluate("el => el.click()")
        print("  Clicked Done")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  URL: {page.url}")

        # ── STEP 5: Extract listings ──────────────────────────────────────
        print(f"STEP 5: Extract up to {max_results} listings...")

        # Scroll to load listings
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Extract using property cards
        cards = page.locator("article.placard")
        count = cards.count()
        if count == 0:
            cards = page.locator('[data-listingid]')
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
                        'span.js-placardTitle, '
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
                        'div.property-address, '
                        'address, '
                        'p[class*="addr"]'
                    ).first
                    address = addr_el.inner_text(timeout=3000).strip()
                except Exception:
                    pass

                # Price — collect all priceTextBox entries in the rent rollup
                price = "N/A"
                try:
                    price_boxes = card.locator('div.priceTextBox')
                    pcount = price_boxes.count()
                    if pcount > 0:
                        prices = []
                        for pi in range(pcount):
                            prices.append(price_boxes.nth(pi).inner_text(timeout=2000).strip())
                        price = " - ".join([prices[0], prices[-1]]) if len(prices) > 1 else prices[0]
                except Exception:
                    # Fallback selectors
                    try:
                        price_el = card.locator(
                            'div.rentRollup, '
                            '[class*="property-pricing"], '
                            'p.property-pricing'
                        ).first
                        raw = price_el.inner_text(timeout=3000).strip()
                        # Extract dollar amounts from the raw text
                        import re as _re
                        found = _re.findall(r"\\$[\\d,]+\\+?", raw)
                        price = " - ".join([found[0], found[-1]]) if len(found) > 1 else (found[0] if found else raw)
                    except Exception:
                        pass

                # Beds / Baths — collect all bedTextBox entries
                beds_baths = "N/A"
                try:
                    bed_boxes = card.locator('div.bedTextBox')
                    bcount = bed_boxes.count()
                    if bcount > 0:
                        beds = []
                        for bi in range(bcount):
                            beds.append(bed_boxes.nth(bi).inner_text(timeout=2000).strip())
                        beds_baths = " - ".join([beds[0], beds[-1]]) if len(beds) > 1 else beds[0]
                except Exception:
                    try:
                        bb_el = card.locator(
                            '[class*="property-beds"], '
                            'p.property-beds'
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
                        if candidate and len(candidate) > 3 and not re.match(r"^[\\$]", candidate):
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

// ── Concretized Step Functions (zero AI calls for navigation) ────────────────

/**
 * Navigate to apartments.com homepage, type location in search bar,
 * and submit to get the results page. Works with any free-form location.
 */
async function searchForLocation(stagehand, page, recorder, location) {
  console.log(`🔍 Searching for "${location}"...`);

  // Navigate to homepage
  const homeUrl = CFG.url;
  console.log(`🌐 Loading ${homeUrl}...`);
  recorder.goto(homeUrl);
  await page.goto(homeUrl);
  await page.waitForLoadState("domcontentloaded");
  console.log("✅ Loaded\n");
  recorder.wait(CFG.waits.page, "Initial page load");
  await page.waitForTimeout(CFG.waits.page);

  // The homepage uses a custom div.smart-search-input widget, not
  // a standard <input>. We need to:
  //   1. Click the search area to activate it (may open a modal / reveal an input)
  //   2. Type the location
  //   3. Handle autocomplete suggestions
  //
  // stagehand.act() is the most reliable way to deal with custom search widgets.

  // Step A: Click the search area to activate it
  console.log("   Activating search bar...");
  await stagehand.act(
    "Click the search bar / search input area on the page to start typing a location"
  );
  await page.waitForTimeout(1000);
  recorder.record("act", {
    instruction: "Click search bar to activate",
    description: "Activate homepage search widget",
    method: "act",
  });

  // Step B: Type the location
  // After activation, there might now be a real input. Try to find it.
  const inputAppeared = await page.evaluate(`(() => {
    const candidates = document.querySelectorAll(
      'input[type="text"], input[type="search"], input:not([type]), input[placeholder]'
    );
    for (const inp of candidates) {
      if (inp.offsetParent !== null || inp.getClientRects().length > 0) {
        return { id: inp.id, placeholder: inp.placeholder, tag: inp.tagName };
      }
    }
    return null;
  })()`);

  if (inputAppeared) {
    console.log(`   Input found: id="${inputAppeared.id}" placeholder="${inputAppeared.placeholder}"`);
    // Use observe+act to click the actual input, then type
    const inputActions = await stagehand.observe(
      "Find the text input field where I can type a city, address, or zip code to search for apartments"
    );
    if (inputActions.length > 0) {
      await stagehand.act(inputActions[0]);
      await page.waitForTimeout(200);
    }
    await page.keyPress("Control+a");
    await page.waitForTimeout(100);
    await page.type(location, { delay: 80 });
  } else {
    // No standard input appeared — type directly (the widget may accept keystrokes)
    console.log("   No standard input found, typing via act...");
    await stagehand.act(`Type "${location}" into the search field`);
  }
  console.log(`   Typed: "${location}"`);
  recorder.record("act", {
    instruction: `Type "${location}" in search bar`,
    description: `Search for ${location}`,
    method: "observe+act+type",
  });
  await page.waitForTimeout(2500); // wait for autocomplete suggestions

  // Step C: Select autocomplete suggestion or submit
  // Try to click the first autocomplete/suggestion item
  const suggestionClicked = await page.evaluate(`(() => {
    const items = document.querySelectorAll(
      '.autocompleteList li, .suggestItem, [class*="suggestion"] li, ' +
      '[class*="autocomplete"] li, [role="option"], [role="listbox"] li'
    );
    for (const item of items) {
      if (item.offsetParent !== null || item.getClientRects().length > 0) {
        item.click();
        return item.textContent.trim().substring(0, 80);
      }
    }
    return false;
  })()`);

  if (suggestionClicked) {
    console.log(`   Clicked autocomplete: "${suggestionClicked}"`);
    recorder.record("act", {
      instruction: "Click first autocomplete suggestion",
      description: `Select: ${suggestionClicked}`,
      method: "evaluate+click",
    });
  } else {
    // Try stagehand.act to click a suggestion, otherwise press Enter
    try {
      await stagehand.act(
        `Click the first autocomplete suggestion or search result for "${location}" in the dropdown list`
      );
      console.log("   Clicked autocomplete (via act)");
      recorder.record("act", {
        instruction: "Click first autocomplete suggestion",
        description: "Select autocomplete suggestion via act",
        method: "act",
      });
    } catch (_) {
      console.log("   No autocomplete found, pressing Enter...");
      await page.keyPress("Enter");
      recorder.record("act", {
        instruction: "Press Enter to search",
        description: "Submit location search",
        method: "keyPress",
      });
    }
  }

  // Wait for results page to load
  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (_) { /* */ }
  await page.waitForTimeout(CFG.waits.search);
  const currentUrl = await page.evaluate("window.location.href");
  console.log(`   📍 Results URL: ${currentUrl}`);

  // Verify we landed on a results page
  const pageCheck = await page.evaluate(`(() => {
    const hasRentFilter = !!document.querySelector('#rentRangeLink');
    const hasListings = document.querySelectorAll('article.placard, [data-listingid]').length;
    const title = document.title;
    return { hasRentFilter, hasListings, title };
  })()`);
  console.log(`   📍 Page: "${pageCheck.title}"`);
  console.log(`   📍 Rent filter: ${pageCheck.hasRentFilter}, Listings: ${pageCheck.hasListings}`);
  if (!pageCheck.hasRentFilter && pageCheck.hasListings === 0) {
    console.log("   ⚠️  May not be on results page, waiting longer...");
    await page.waitForTimeout(5000);
  }
}

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
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
  await page.waitForTimeout(500);
}

/**
 * Open the Price filter dropdown and set min/max values.
 *
 * Uses observe+act pattern for the input fields: page.evaluate() focus
 * doesn't set Playwright's internal focus tracking, so we must use
 * stagehand.act() (or observe→act) to click inputs. This dispatches
 * a real Chromium mouse event that properly sets focus, after which
 * page.type() works correctly.
 *
 * Opening the dropdown is done via evaluate (reliable for simple clicks).
 * The Done button click is also done via evaluate.
 *
 *   #rentRangeLink → open dropdown  (evaluate click)
 *   #min-input     → observe+act to click, then page.type()
 *   #max-input     → observe+act to click, then page.type()
 *   .done-btn      → evaluate click
 */
async function applyPriceFilter(stagehand, page, recorder, priceMin, priceMax) {
  console.log(`🎯 STEP 1: Price filter $${priceMin.toLocaleString()} - $${priceMax.toLocaleString()}...`);

  // Wait for the price filter link to appear (may take time after page load)
  let opened = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    opened = await page.evaluate(`(() => {
      const link = document.querySelector('#rentRangeLink');
      if (link && (link.offsetParent !== null || link.getClientRects().length > 0)) {
        link.click(); return true;
      }
      return false;
    })()`);
    if (opened) break;
    console.log(`   Waiting for #rentRangeLink... (attempt ${attempt + 1})`);
    await page.waitForTimeout(3000);
  }
  if (!opened) {
    // Last resort: use stagehand.act to find and click the price filter
    console.log("   Trying stagehand.act to find price filter...");
    try {
      await stagehand.act("Click on the 'Price' filter button or link to open the price range dropdown");
      opened = true;
    } catch (e) {
      throw new Error("Could not find price filter on results page");
    }
  }
  console.log("   Opened price dropdown");
  recorder.record("act", {
    instruction: "Open price filter dropdown",
    description: "Click #rentRangeLink",
    selector: SEL.priceLink,
    method: "click",
  });
  await page.waitForTimeout(1500);

  // ── Set minimum price using observe+act ────────────────────────────────
  // observe finds the input, act clicks it (setting real Chromium focus),
  // then page.type() enters the value into the focused element.
  console.log("   Observing min price input...");
  const minActions = await stagehand.observe(
    "Find the minimum price input field with placeholder 'Min Price'"
  );
  if (minActions.length === 0) throw new Error("observe could not find min price input");
  console.log(`   Found: ${minActions[0].description}`);

  await stagehand.act(minActions[0]);
  await page.waitForTimeout(300);
  await page.keyPress("Control+a");
  await page.waitForTimeout(100);
  await page.type(String(priceMin), { delay: 80 });
  console.log(`   Set min: ${priceMin}`);
  recorder.record("act", {
    instruction: `Type ${priceMin} in min price input`,
    description: `Set min price: ${priceMin}`,
    selector: minActions[0].selector || SEL.minInput,
    method: "observe+act+type",
  });
  await page.waitForTimeout(500);

  // ── Set maximum price using observe+act ────────────────────────────────
  console.log("   Observing max price input...");
  const maxActions = await stagehand.observe(
    "Find the maximum price input field with placeholder 'Max Price'"
  );
  if (maxActions.length === 0) throw new Error("observe could not find max price input");
  console.log(`   Found: ${maxActions[0].description}`);

  await stagehand.act(maxActions[0]);
  await page.waitForTimeout(300);
  await page.keyPress("Control+a");
  await page.waitForTimeout(100);
  await page.type(String(priceMax), { delay: 80 });
  console.log(`   Set max: ${priceMax}`);
  recorder.record("act", {
    instruction: `Type ${priceMax} in max price input`,
    description: `Set max price: ${priceMax}`,
    selector: maxActions[0].selector || SEL.maxInput,
    method: "observe+act+type",
  });
  await page.waitForTimeout(500);

  // Verify values were set in the DOM
  const verify = await page.evaluate(`(() => {
    const min = document.querySelector('#min-input');
    const max = document.querySelector('#max-input');
    return { minVal: min ? min.value : 'N/A', maxVal: max ? max.value : 'N/A' };
  })()`);
  console.log(`   Verify inputs — min: "${verify.minVal}", max: "${verify.maxVal}"`);

  // ── Click Done to apply filter ─────────────────────────────────────────
  // Observe+act for Done button (or evaluate click — both work since it's
  // a simple button, not an input requiring focus). Use observe+act for
  // reliability in case DOM structure changes.
  const doneActions = await stagehand.observe(
    "Find the Done button in the price filter dropdown"
  );
  if (doneActions.length > 0) {
    await stagehand.act(doneActions[0]);
    console.log("   ✅ Clicked Done (observe+act)");
  } else {
    // Fallback: evaluate click
    const done = await page.evaluate(`(() => {
      const btn = document.querySelector('.done-btn');
      if (btn) { btn.click(); return true; }
      return false;
    })()`);
    if (done) console.log("   ✅ Clicked Done (evaluate)");
    else {
      await page.keyPress("Enter");
      console.log("   Pressed Enter (fallback)");
    }
  }
  recorder.record("act", {
    instruction: "Click Done to apply price filter",
    description: "Apply price filter",
    selector: SEL.doneBtn,
    method: "click",
  });

  await page.waitForTimeout(CFG.waits.search);
  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (e) { /* */ }
  await page.waitForTimeout(3000);

  // Verify filter applied
  const filterState = await page.evaluate(`(() => {
    const priceLink = document.querySelector('#rentRangeLink');
    return {
      priceLinkText: priceLink ? priceLink.textContent.trim() : 'N/A',
      url: window.location.href,
    };
  })()`);
  console.log(`   📍 URL: ${filterState.url}`);
  console.log(`   📍 Price label: "${filterState.priceLinkText}"`);
  if (filterState.priceLinkText === 'Price' && !filterState.url.includes(String(priceMin))) {
    console.log("   ⚠️  WARNING: Price filter may not have applied");
  }
}

/**
 * Extract apartment listings. Uses stagehand.extract() (AI) with zod schema.
 * This is the only AI call — the card DOM is complex and AI extraction
 * produced perfect results in v1.
 */
async function extractListings(stagehand, page, recorder) {
  console.log(`🎯 STEP 2: Extract up to ${CFG.maxResults} listings...\n`);
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
      `Extract the top ${CFG.maxResults} apartment listings from the search results. For each listing, get: 1) the property name, 2) the full street address including city/state/zip, 3) the monthly rent price or price range (like "$1,200/mo" or "$1,100 - $1,800"), and 4) beds/baths info (like "1-3 Beds, 1-2 Baths" or "Studio - 2 Beds"). Skip any ads, sponsored content, or properties outside the visible listings. Only extract real apartment listings.`,
      z.object({
        apartments: z.array(z.object({
          name: z.string().describe("Property name"),
          address: z.string().describe("Full street address with city, state, zip"),
          price: z.string().describe("Monthly rent price or range, e.g. '$1,200/mo' or '$1,100 - $1,800'"),
          bedsBaths: z.string().describe("Beds and baths info, e.g. '1-3 Beds, 1-2 Baths' or 'Studio - 2 Beds'"),
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
      const priceMatch = line.match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?/);
      if (priceMatch && line.length < 150) {
        let name = "N/A", address = "N/A";
        for (let j = Math.max(0, i - 5); j < i; j++) {
          const candidate = lines[j].trim();
          if (candidate && candidate.length > 3 && !candidate.match(/^\$/)) {
            if (name === "N/A") name = candidate;
            else if (address === "N/A") address = candidate;
          }
        }
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
  console.log("  Apartments.com – Apartment Search  (concretized v2)");
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

    // Search for location via homepage search bar
    await searchForLocation(stagehand, page, recorder, CFG.location);

    // Dismiss popups after navigation
    await dismissPopups(page);

    // Apply price filter
    await applyPriceFilter(stagehand, page, recorder, CFG.priceMin, CFG.priceMax);

    // Extract listings (1 AI call for structured data extraction)
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
