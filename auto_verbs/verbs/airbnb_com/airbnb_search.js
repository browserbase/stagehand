const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Airbnb – Vacation Rental Search
 *
 * Uses page.evaluate() for DOM traversal + page.click(x,y) & page.type()
 * for form filling, then stagehand.extract() for results.
 *
 * Stagehand Page API:
 *   page.evaluate(expr, arg)       — run JS in browser
 *   page.click(x, y)               — click at screen coordinates
 *   page.type(text, {delay})       — type text into focused element
 *   page.keyPress("Control+a")     — key combo
 *   page.goto(url), page.url(), page.waitForTimeout(ms), page.waitForLoadState()
 */

// ── Date Computation ─────────────────────────────────────────────────────────
function computeDates() {
  const today = new Date();
  const checkin = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const checkout = new Date(checkin);
  checkout.setDate(checkout.getDate() + 3);
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const fmtDisplay = (d) =>
    `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}/${d.getFullYear()}`;
  return {
    checkin: fmt(checkin),
    checkout: fmt(checkout),
    checkinDisplay: fmtDisplay(checkin),
    checkoutDisplay: fmtDisplay(checkout),
  };
}
const dates = computeDates();

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.airbnb.com",
  destination: "Lake Tahoe",
  checkin: dates.checkin,
  checkout: dates.checkout,
  checkinDisplay: dates.checkinDisplay,
  checkoutDisplay: dates.checkoutDisplay,
  nights: 3,
  guests: 2,
  maxResults: 5,
  waits: { page: 4000, type: 2000, select: 1500, search: 8000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
// Reads the concretized Python file from disk and applies cfg-based
// substitutions for default parameter values.
function genPython(cfg, recorder) {
  const pyPath = path.join(__dirname, "airbnb_search.py");
  if (fs.existsSync(pyPath)) {
    let content = fs.readFileSync(pyPath, "utf-8");
    content = content.replace(
      /destination:\s*str\s*=\s*"[^"]*"/,
      `destination: str = "${cfg.destination}"`
    );
    content = content.replace(
      /max_results:\s*int\s*=\s*\d+/,
      `max_results: int = ${cfg.maxResults}`
    );
    content = content.replace(
      /num_guests:\s*int\s*=\s*\d+/,
      `num_guests: int = ${cfg.guests}`
    );
    content = content.replace(
      /nights:\s*int\s*=\s*\d+/,
      `nights: int = ${cfg.nights}`
    );
    content = content.replace(
      /page\.goto\("https:\/\/www\.airbnb\.com[^"]*"\)/,
      `page.goto("${cfg.url}")`
    );
    return content;
  }
  // Fallback if .py doesn't exist yet — generate inline
  console.warn("⚠️  airbnb_search.py not found; generating inline Python.");
  return genPythonInline(cfg, recorder);
}

function genPythonInline(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Airbnb – Vacation Rental Search
Destination: ${cfg.destination}
Check-in: ${cfg.checkinDisplay}  Check-out: ${cfg.checkoutDisplay}  (${cfg.nights} nights, ${cfg.guests} guests)

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


MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def compute_dates(nights=3):
    today = date.today()
    checkin = today + relativedelta(months=2)
    checkout = checkin + timedelta(days=nights)
    return checkin, checkout


def run(
    playwright: Playwright,
    destination: str = "${cfg.destination}",
    num_guests: int = ${cfg.guests},
    nights: int = ${cfg.nights},
    max_results: int = ${cfg.maxResults},
) -> list:
    checkin, checkout = compute_dates(nights)
    checkin_str = checkin.strftime("%Y-%m-%d")
    checkout_str = checkout.strftime("%Y-%m-%d")
    checkin_display = checkin.strftime("%m/%d/%Y")
    checkout_display = checkout.strftime("%m/%d/%Y")
    checkin_month_name = MONTH_NAMES[checkin.month - 1]
    checkout_month_name = MONTH_NAMES[checkout.month - 1]

    print(f"  Destination: {destination}")
    print(f"  Check-in: {checkin_display}  Check-out: {checkout_display}  ({nights} nights, {num_guests} guests)\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("airbnb_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate ──────────────────────────────────────────────────
        print("Loading Airbnb...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(4000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups ────────────────────────────────────────────
        for selector in [
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
        page.wait_for_timeout(1000)

        # ── STEP 1: Enter destination ─────────────────────────────────
        print(f'STEP 1: Destination = "{destination}"...')
        search_input = page.locator('input[name="query"], input[placeholder*="Search"], input[id*="bigsearch"]').first
        try:
            search_input.wait_for(state="visible", timeout=5000)
            search_input.evaluate("el => el.click()")
        except Exception:
            # Airbnb sometimes needs a click on the search bar area first
            page.locator('[data-testid="structured-search-input-field-query"], button:has-text("Anywhere")').first.evaluate("el => el.click()")
            page.wait_for_timeout(1000)
            search_input = page.locator('input[name="query"], input[placeholder*="Search"]').first
            search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)

        page.keyboard.press("Control+a")
        page.keyboard.type(destination, delay=50)
        print(f'  Typed "{destination}"')
        page.wait_for_timeout(2000)

        # Select suggestion
        try:
            suggestion = page.locator('[data-testid="option-0"], [id*="bigsearch-query-location-suggestion-0"], [role="option"]').first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
            print("  Selected first suggestion")
        except Exception:
            page.keyboard.press("Enter")
            print("  No suggestion, pressed Enter")
        page.wait_for_timeout(1500)

        # ── STEP 2: Set dates ─────────────────────────────────────────
        print(f"STEP 2: Dates — Check-in: {checkin_display}, Check-out: {checkout_display}...")

        # Airbnb usually shows calendar after selecting a destination
        # Navigate to the correct month and click the dates
        # data-testid="calendar-day-MM/DD/YYYY" format is common on Airbnb
        for _ in range(8):
            try:
                ci_cell = page.locator(f'[data-testid="calendar-day-{checkin_str}"], td[data-date="{checkin_str}"]').first
                if ci_cell.is_visible(timeout=2000):
                    break
            except Exception:
                pass
            # Click next month arrow
            try:
                page.locator('button[aria-label*="forward"], button[aria-label*="Next"], [data-testid="calendar-navigate-forward"]').first.evaluate("el => el.click()")
                page.wait_for_timeout(800)
            except Exception:
                break

        # Click check-in date
        try:
            ci_cell = page.locator(f'[data-testid="calendar-day-{checkin_str}"], td[data-date="{checkin_str}"]').first
            ci_cell.evaluate("el => el.click()")
            print(f"  Clicked check-in: {checkin_str}")
        except Exception:
            print(f"  WARNING: could not find check-in date cell")
        page.wait_for_timeout(1000)

        # Click check-out date (should be on same calendar view since it's 3 days later)
        try:
            co_cell = page.locator(f'[data-testid="calendar-day-{checkout_str}"], td[data-date="{checkout_str}"]').first
            co_cell.evaluate("el => el.click()")
            print(f"  Clicked check-out: {checkout_str}")
        except Exception:
            print(f"  WARNING: could not find check-out date cell")
        page.wait_for_timeout(1000)

        # ── STEP 3: Set guests ────────────────────────────────────────
        print(f"STEP 3: Guests = {num_guests}...")
        try:
            guest_btn = page.locator('[data-testid="structured-search-input-field-guests-button"], button:has-text("guest"), button:has-text("Add guests"), button:has-text("Who")').first
            guest_btn.evaluate("el => el.click()")
            page.wait_for_timeout(1000)

            # Airbnb guest picker: Adults increase button
            adults_label = page.locator('[data-testid="stepper-adults-increase-button"], button[aria-label*="increase"][aria-label*="Adults" i]').first
            for _ in range(num_guests):
                adults_label.evaluate("el => el.click()")
                page.wait_for_timeout(300)
            print(f"  Set {num_guests} adults")
        except Exception:
            print(f"  WARNING: could not set guest count")
        page.wait_for_timeout(1000)

        # ── STEP 4: Search ────────────────────────────────────────────
        print("STEP 4: Search...")
        try:
            search_btn = page.locator('[data-testid="structured-search-input-search-button"], button[type="submit"], button:has-text("Search")').first
            search_btn.evaluate("el => el.click()")
            print("  Clicked Search button")
        except Exception:
            page.keyboard.press("Enter")
            print("  Pressed Enter to search")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(8000)
        print(f"  URL: {page.url}")

        # ── STEP 5: Extract listings ──────────────────────────────────
        print(f"STEP 5: Extract up to {max_results} listings...")

        # Scroll to load lazy content
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # DOM extraction using Airbnb card selectors
        js_listings = page.evaluate(r'''((maxResults) => {
            const results = [];
            const seen = new Set();
            const cardSelectors = [
                '[data-testid="card-container"]',
                '[itemprop="itemListElement"]',
                '[class*="StayCard"]',
                '[class*="listing-card"]',
                '[class*="PropertyCard"]',
                '[data-testid="listing-card"]',
                'div[aria-labelledby]',
            ];
            let cards = [];
            for (const sel of cardSelectors) {
                const c = document.querySelectorAll(sel);
                if (c.length >= 1 && c.length <= 50) { cards = c; break; }
            }
            if (cards.length === 0) {
                for (const sel of cardSelectors) {
                    const c = document.querySelectorAll(sel);
                    if (c.length > 0) { cards = c; break; }
                }
            }
            for (const card of Array.from(cards).slice(0, maxResults * 3)) {
                const text = (card.textContent || '').replace(/\\s+/g, ' ').trim();
                if (text.length < 10) continue;
                // Title: first substantial text link/heading
                let title = 'N/A';
                const titleEl = card.querySelector('[data-testid="listing-card-title"], [id*="title"], h3, [class*="title"], a[aria-label]');
                if (titleEl) {
                    title = (titleEl.getAttribute('aria-label') || titleEl.textContent || '').trim().substring(0, 120);
                }
                if (title === 'N/A' || title.length < 3) {
                    // Try first link text
                    const link = card.querySelector('a');
                    if (link) title = (link.getAttribute('aria-label') || link.textContent || '').trim().substring(0, 120);
                }
                // Price
                let price = 'N/A';
                const priceMatch = text.match(/\\$(\\d[\\d,]*)/);
                if (priceMatch) price = '$' + priceMatch[1];
                // Rating
                let rating = 'N/A';
                const ratingMatch = text.match(/(\\d\\.\\d+)\\s*(?:\\(|out of)/);
                if (ratingMatch) rating = ratingMatch[1];
                else {
                    const ratingMatch2 = text.match(/(\\d\\.\\d+)\\s*\\·/);
                    if (ratingMatch2) rating = ratingMatch2[1];
                }
                // Deduplicate
                const key = title.toLowerCase().substring(0, 50);
                if (seen.has(key)) continue;
                seen.add(key);
                if (title !== 'N/A' || price !== 'N/A')
                    results.push({title, price, rating});
                if (results.length >= maxResults) break;
            }
            return results;
        })(''' + str(max_results) + ')')

        results = [{"title": l["title"], "price": l["price"], "rating": l["rating"]} for l in js_listings]

        # Fallback: body text regex
        if not results:
            print("  Card extraction failed, trying text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            for line in body_text.split('\\n'):
                if len(results) >= max_results:
                    break
                pm = re.search(r'\\$(\\d[\\d,]*)', line)
                if pm and len(line.strip()) > 10 and len(line.strip()) < 200:
                    results.append({
                        "title": line.strip()[:100],
                        "price": "$" + pm.group(1),
                        "rating": "N/A",
                    })

        # ── Print results ─────────────────────────────────────────────
        print(f"\\nFound {len(results)} listings in '{destination}':")
        print(f"  Check-in: {checkin_display}  Check-out: {checkout_display}  ({nights} nights, {num_guests} guests)\\n")
        for i, listing in enumerate(results, 1):
            print(f"  {i}. {listing['title']}")
            print(f"     Price: {listing['price']}/night  Rating: {listing['rating']}")

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
        print(f"\\nTotal listings found: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(stagehand, page) {
  console.log("🔲 Dismissing popups...");
  await page.waitForTimeout(2000);

  // DOM-based dismiss
  for (const strategy of [
    `(() => {
      const btns = document.querySelectorAll('button, a');
      for (const btn of btns) {
        const txt = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase().trim();
        if (['close', 'dismiss', 'accept', 'got it', 'ok', 'i understand', 'translation off', 'skip'].includes(txt)) {
          if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
            btn.click(); return true;
          }
        }
      }
      return false;
    })()`,
    `(() => {
      const btns = document.querySelectorAll('[aria-label="Close"], [aria-label="close"], [data-dismiss="modal"]');
      for (const btn of btns) {
        if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
          btn.click(); return true;
        }
      }
      return false;
    })()`,
  ]) {
    try {
      const clicked = await page.evaluate(strategy);
      if (clicked) console.log("   ✅ Dismissed a popup (DOM)");
      await page.waitForTimeout(500);
    } catch (e) { /* no popup */ }
  }
  await page.waitForTimeout(1000);
}

async function enterDestination(stagehand, page, recorder, destination) {
  console.log(`🎯 STEP 1: Destination = "${destination}"...`);

  // Airbnb has a search bar on the homepage. Try DOM-based click first.
  const searchFieldClicked = await page.evaluate(`(() => {
    // Airbnb search: look for the main search input or the "Where" trigger area
    const inputs = document.querySelectorAll(
      'input[name="query"], input[placeholder*="Search" i], input[id*="bigsearch"]'
    );
    for (const inp of inputs) {
      if (inp.offsetParent !== null || inp.getClientRects().length > 0) {
        inp.scrollIntoView({ block: 'center' });
        const r = inp.getBoundingClientRect();
        return { x: r.x + r.width/2, y: r.y + r.height/2, method: 'input' };
      }
    }
    // Try clicking on the search bar container / "Anywhere" / "Where" buttons
    const triggers = document.querySelectorAll(
      '[data-testid="structured-search-input-field-query"], button, div[role="button"]'
    );
    for (const el of triggers) {
      const text = (el.textContent || el.getAttribute('aria-label') || '').trim().toLowerCase();
      if (text.includes('where') || text.includes('anywhere') || text.includes('search destinations')) {
        if (el.offsetParent !== null || el.getClientRects().length > 0) {
          const r = el.getBoundingClientRect();
          if (r.width > 40 && r.height > 15 && r.y < 400)
            return { x: r.x + r.width/2, y: r.y + r.height/2, method: 'trigger' };
        }
      }
    }
    return null;
  })()`);

  if (searchFieldClicked) {
    await page.click(searchFieldClicked.x, searchFieldClicked.y);
    console.log(`   ✅ Clicked search field (${searchFieldClicked.method})`);
  } else {
    console.log("   ⚠️ DOM search field not found — trying AI...");
    await stagehand.act("Click on the search bar / 'Where' field on Airbnb to enter a destination");
    console.log("   ✅ Clicked search field via AI");
  }
  await page.waitForTimeout(1500);

  // Now look for the text input that appeared (may be inside an expanded search panel)
  const inputCoords = await page.evaluate(`(() => {
    const inputs = document.querySelectorAll(
      'input[name="query"], input[placeholder*="Search" i], input[id*="bigsearch"], input[placeholder*="destinations" i]'
    );
    for (const inp of inputs) {
      if (inp.offsetParent !== null || inp.getClientRects().length > 0) {
        const r = inp.getBoundingClientRect();
        if (r.width > 50 && r.height > 10)
          return { x: r.x + r.width/2, y: r.y + r.height/2 };
      }
    }
    return null;
  })()`);
  if (inputCoords) {
    await page.click(inputCoords.x, inputCoords.y);
    await page.waitForTimeout(300);
  }

  await page.keyPress("Ctrl+a");
  await page.type(destination, { delay: 50 });
  console.log(`   ✅ Typed "${destination}"`);
  recorder.record("act", { instruction: `Type destination: ${destination}`, description: `Typed ${destination}` });
  await page.waitForTimeout(CFG.waits.type);

  // DOM-based suggestion selection
  const sugClicked = await page.evaluate(`(() => {
    const candidates = document.querySelectorAll(
      '[data-testid="option-0"], [id*="bigsearch-query-location-suggestion-0"], [role="option"], li[id*="option"]'
    );
    for (const el of candidates) {
      if (el.offsetParent !== null || el.getClientRects().length > 0) {
        const r = el.getBoundingClientRect();
        if (r.width > 30 && r.height > 15)
          return { x: r.x + r.width/2, y: r.y + r.height/2, text: (el.textContent || '').trim().substring(0, 80) };
      }
    }
    // Broader: first visible list item in dropdown
    const items = document.querySelectorAll('ul li, [role="listbox"] > *');
    for (const el of items) {
      const text = (el.textContent || '').trim();
      if (text.length > 3 && text.length < 200 && /tahoe/i.test(text)) {
        if (el.offsetParent !== null || el.getClientRects().length > 0) {
          const r = el.getBoundingClientRect();
          if (r.width > 30 && r.height > 15)
            return { x: r.x + r.width/2, y: r.y + r.height/2, text: text.substring(0, 80) };
        }
      }
    }
    return null;
  })()`);

  if (sugClicked) {
    await page.click(sugClicked.x, sugClicked.y);
    console.log(`   ✅ Selected suggestion (DOM): ${sugClicked.text}`);
  } else {
    // Fallback to AI
    try {
      await stagehand.act(`Click on the first autocomplete suggestion that mentions "Lake Tahoe" or "Tahoe" in the dropdown list. Do not click search buttons.`);
      console.log("   ✅ Selected suggestion via AI");
    } catch (e) {
      console.log("   ⚠️ No suggestion found, pressing Enter...");
      await page.keyPress("Enter");
    }
  }
  recorder.record("act", { instruction: "Select suggestion", description: "Selected Lake Tahoe from suggestions" });
  await page.waitForTimeout(CFG.waits.select);
}

async function setDates(stagehand, page, recorder, checkinStr, checkoutStr) {
  console.log(`🎯 STEP 2: Dates — will be injected via URL params after search`);
  console.log(`   Check-in: ${checkinStr}, Check-out: ${checkoutStr}`);
  console.log(`   (Airbnb's stepped search panel makes calendar interaction fragile;`);
  console.log(`    using URL parameter injection for reliable date setting)`);
  recorder.record("act", { instruction: `Set dates ${checkinStr} to ${checkoutStr}`, description: "Dates to be set via URL params" });
}

async function setGuests(stagehand, page, recorder, numGuests) {
  console.log(`🎯 STEP 3: Guests = ${numGuests}...`);

  // Try to open the guest picker
  const guestFieldClicked = await page.evaluate(`(() => {
    const triggers = document.querySelectorAll(
      '[data-testid="structured-search-input-field-guests-button"], button, div[role="button"]'
    );
    for (const el of triggers) {
      const text = (el.textContent || el.getAttribute('aria-label') || '').toLowerCase();
      if (text.includes('guest') || text.includes('who') || text.includes('add guest')) {
        if (el.offsetParent !== null || el.getClientRects().length > 0) {
          const r = el.getBoundingClientRect();
          if (r.y < 500)
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
        }
      }
    }
    return null;
  })()`);

  if (guestFieldClicked) {
    await page.click(guestFieldClicked.x, guestFieldClicked.y);
    console.log("   ✅ Opened guest picker");
  } else {
    await stagehand.act("Click on the 'Who' or 'Guests' field to open the guest count selector");
    console.log("   ✅ Opened guest picker via AI");
  }
  await page.waitForTimeout(1000);

  // Click the increase button for Adults N times
  for (let i = 0; i < numGuests; i++) {
    const increaseClicked = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button');
      for (const btn of btns) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
        if ((aria.includes('increase') && aria.includes('adult')) ||
            testid.includes('stepper-adults-increase') ||
            testid.includes('adults-increase')) {
          if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
            const r = btn.getBoundingClientRect();
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
          }
        }
      }
      return null;
    })()`);

    if (increaseClicked) {
      await page.click(increaseClicked.x, increaseClicked.y);
      await page.waitForTimeout(300);
    } else if (i === 0) {
      // Fallback to AI for the first click
      await stagehand.act("Click the + (increase/plus) button next to 'Adults' to add one adult guest");
      await page.waitForTimeout(300);
      // Get the button coords for subsequent clicks
      break;
    }
  }
  console.log(`   ✅ Set ${numGuests} adult guests`);
  recorder.record("act", { instruction: `Set ${numGuests} guests`, description: `Set guests to ${numGuests}` });
  await page.waitForTimeout(500);
}

async function clickSearch(stagehand, page, recorder) {
  console.log("🎯 STEP 4: Search...");

  const searchClicked = await page.evaluate(`(() => {
    // Airbnb search button
    const btns = document.querySelectorAll('button, a');
    for (const btn of btns) {
      const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const text = (btn.textContent || '').trim().toLowerCase();
      if (testid.includes('search-button') || testid.includes('structured-search-input-search') || 
          aria.includes('search') || 
          (text === 'search' && btn.tagName === 'BUTTON')) {
        if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
          const r = btn.getBoundingClientRect();
          if (r.width > 20 && r.height > 20)
            return { x: r.x + r.width/2, y: r.y + r.height/2 };
        }
      }
    }
    // Also try the magnifying glass icon
    const svgParents = document.querySelectorAll('button svg, a svg');
    for (const svg of svgParents) {
      const parent = svg.closest('button') || svg.closest('a');
      if (parent && parent.offsetParent !== null) {
        const testid = (parent.getAttribute('data-testid') || '').toLowerCase();
        if (testid.includes('search')) {
          const r = parent.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2 };
        }
      }
    }
    return null;
  })()`);

  if (searchClicked) {
    await page.click(searchClicked.x, searchClicked.y);
    console.log("   ✅ Clicked Search button (DOM)");
  } else {
    await stagehand.act("Click the Search button (the red/pink button with a magnifying glass icon)");
    console.log("   ✅ Clicked Search button via AI");
  }

  // Wait for navigation & results
  await page.waitForTimeout(CFG.waits.search);
  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (e) { /* ok */ }
  await page.waitForTimeout(CFG.waits.search);
  console.log(`   📍 URL: ${page.url()}`);
  recorder.record("act", { instruction: "Click Search", description: "Searched" });
}

async function injectDatesViaUrl(page, recorder, checkinStr, checkoutStr, numGuests) {
  console.log(`🎯 STEP 4b: Injecting dates & guests via URL params...`);
  const currentUrl = page.url();
  console.log(`   Current URL: ${currentUrl}`);

  try {
    const url = new URL(currentUrl);
    url.searchParams.set('checkin', checkinStr);
    url.searchParams.set('checkout', checkoutStr);
    url.searchParams.set('adults', String(numGuests));
    // Remove any conflicting params
    url.searchParams.delete('flexible_trip_lengths[]');
    url.searchParams.delete('date_picker_type');

    const newUrl = url.toString();
    console.log(`   New URL: ${newUrl}`);
    await page.goto(newUrl);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(6000);
    console.log(`   ✅ Reloaded with dates: ${checkinStr} → ${checkoutStr}, ${numGuests} guests`);
    console.log(`   📍 Final URL: ${page.url()}`);
  } catch (e) {
    // Fallback: construct the URL from scratch
    const dest = encodeURIComponent(CFG.destination.replace(/\s+/g, '-'));
    const fallbackUrl = `https://www.airbnb.com/s/${dest}/homes?checkin=${checkinStr}&checkout=${checkoutStr}&adults=${numGuests}`;
    console.log(`   URL parse failed, navigating directly: ${fallbackUrl}`);
    await page.goto(fallbackUrl);
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(6000);
    console.log(`   ✅ Loaded fallback URL`);
  }
  recorder.record('act', { instruction: `Inject dates via URL: ${checkinStr} to ${checkoutStr}`, description: 'URL param injection' });
}

async function extractListings(stagehand, page, recorder) {
  console.log(`🎯 STEP 5: Extract up to ${CFG.maxResults} listings...\n`);

  // Scroll to load lazy content
  for (let i = 0; i < 5; i++) {
    await page.evaluate("window.scrollBy(0, 600)");
    await page.waitForTimeout(800);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // DOM extraction — Airbnb listing cards
  const domListings = await page.evaluate(`((maxResults) => {
    const results = [];
    const seen = new Set();
    const cardSelectors = [
      '[data-testid="card-container"]',
      '[itemprop="itemListElement"]',
      '[class*="StayCard"]',
      '[class*="listing-card"]',
      '[class*="PropertyCard"]',
      '[data-testid="listing-card"]',
      'div[aria-labelledby]',
    ];
    let cards = [];
    let selectorUsed = '';
    for (const sel of cardSelectors) {
      try {
        const c = document.querySelectorAll(sel);
        if (c.length >= 1 && c.length <= 60) { cards = c; selectorUsed = sel; break; }
      } catch (e) {}
    }
    if (cards.length === 0) {
      for (const sel of cardSelectors) {
        const c = document.querySelectorAll(sel);
        if (c.length > 0) { cards = c; selectorUsed = sel; break; }
      }
    }

    for (const card of Array.from(cards).slice(0, maxResults * 3)) {
      const text = (card.textContent || '').replace(/\\s+/g, ' ').trim();
      if (text.length < 10) continue;

      // Title
      let title = 'N/A';
      const titleEl = card.querySelector(
        '[data-testid="listing-card-title"], [id*="title"], h3, [class*="title"], a[aria-label]'
      );
      if (titleEl) {
        title = (titleEl.getAttribute('aria-label') || titleEl.textContent || '').trim().substring(0, 120);
      }
      if (title === 'N/A' || title.length < 3) {
        const link = card.querySelector('a');
        if (link) {
          title = (link.getAttribute('aria-label') || link.textContent || '').trim().substring(0, 120);
        }
      }

      // Price per night
      let price = 'N/A';
      const priceMatch = text.match(/\\$(\\d[\\d,]*)/);
      if (priceMatch) price = '$' + priceMatch[1];

      // Rating
      let rating = 'N/A';
      // Pattern: "4.92 (28)" or "4.92 · Superhost" or just "4.92"
      const ratingMatch = text.match(/(\\d\\.\\d+)\\s*(?:\\(|out of|·)/);
      if (ratingMatch) rating = ratingMatch[1];
      else {
        const rm2 = text.match(/(\\d\\.\\d+)/);
        if (rm2 && parseFloat(rm2[1]) >= 1.0 && parseFloat(rm2[1]) <= 5.0)
          rating = rm2[1];
      }

      // Deduplicate
      const key = title.toLowerCase().substring(0, 50);
      if (seen.has(key)) continue;
      seen.add(key);

      if (title !== 'N/A' || price !== 'N/A')
        results.push({ title, price, rating });
      if (results.length >= maxResults) break;
    }

    return { listings: results, cardCount: cards.length, selectorUsed };
  })(${CFG.maxResults})`);

  console.log(`   📊 DOM extraction: ${domListings.listings.length} listings (${domListings.cardCount} cards via "${domListings.selectorUsed}")`);

  let listings;
  if (domListings.listings.length > 0) {
    listings = { listings: domListings.listings };
  } else {
    // Fallback to AI extraction
    console.log("   🤖 Trying AI extraction...");
    const { z } = require("zod/v3");
    listings = await stagehand.extract(
      `Extract up to ${CFG.maxResults} vacation rental listings from this Airbnb search results page.
For each listing, get:
1. The listing title/name
2. The price per night (numeric, like "$150")
3. The guest rating (like "4.92")
Only extract real rental listings, not ads or promotions.`,
      z.object({
        listings: z.array(z.object({
          title: z.string().describe("Listing title"),
          price: z.string().describe("Price per night, e.g. '$150'"),
          rating: z.string().describe("Guest rating, e.g. '4.92'"),
        })).describe(`Up to ${CFG.maxResults} listings`),
      })
    );
  }

  recorder.record("extract", {
    instruction: "Extract listings",
    description: `Extract up to ${CFG.maxResults} Airbnb listings`,
    results: listings,
  });

  console.log(`📋 Found ${listings.listings.length} listings:`);
  listings.listings.forEach((l, i) => {
    console.log(`   ${i + 1}. ${l.title}`);
    console.log(`      💰 ${l.price}/night  ⭐ ${l.rating}`);
  });

  return listings;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Airbnb – Vacation Rental Search");
  console.log("  🔧 page.evaluate + page.click(x,y) + page.type()");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🏠 ${CFG.destination}`);
  console.log(`  📅 Check-in: ${CFG.checkinDisplay}  Check-out: ${CFG.checkoutDisplay}  (${CFG.nights} nights, ${CFG.guests} guests)\n`);

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
    console.log("🌐 Loading Airbnb...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    await dismissPopups(stagehand, page);
    await enterDestination(stagehand, page, recorder, CFG.destination);
    await setDates(stagehand, page, recorder, CFG.checkin, CFG.checkout);
    await setGuests(stagehand, page, recorder, CFG.guests);
    await clickSearch(stagehand, page, recorder);
    await injectDatesViaUrl(page, recorder, CFG.checkin, CFG.checkout, CFG.guests);

    const listings = await extractListings(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${listings.listings.length} listings found`);
    console.log("═══════════════════════════════════════════════════════════");
    listings.listings.forEach((l, i) => {
      console.log(`  ${i + 1}. ${l.title} — ${l.price}/night  ⭐ ${l.rating}`);
    });

    // Save Python + JSON
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "airbnb_search.py");
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
      fs.writeFileSync(path.join(__dirname, "airbnb_search.py"), pyScript, "utf-8");
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
