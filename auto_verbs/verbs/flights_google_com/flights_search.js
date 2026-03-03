const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Google Flights – Round Trip Flight Search
 *
 * Uses AI-driven discovery to interact with Google Flights.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Configuration ────────────────────────────────────────────────────────────
function computeDates() {
  const today = new Date();
  const departure = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const returnDate = new Date(departure);
  returnDate.setDate(returnDate.getDate() + 4);
  const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  const fmtDisplay = (d) => `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  const fmtSlash = (d) => `${d.getFullYear()}/${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}`;
  return {
    departure: fmt(departure),
    returnDate: fmt(returnDate),
    departureDisplay: fmtDisplay(departure),
    returnDisplay: fmtDisplay(returnDate),
    departureSlash: fmtSlash(departure),
    returnSlash: fmtSlash(returnDate),
  };
}
const dates = computeDates();

const CFG = {
  url: "https://www.google.com/travel/flights",
  origin: "Seattle",
  destination: "Chicago",
  departure: dates.departure,
  returnDate: dates.returnDate,
  departureDisplay: dates.departureDisplay,
  returnDisplay: dates.returnDisplay,
  departureSlash: dates.departureSlash,
  returnSlash: dates.returnSlash,
  maxResults: 5,
  waits: { page: 3000, type: 2000, select: 1000, search: 5000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Google Flights – Round Trip Flight Search
Origin: ${cfg.origin} → Destination: ${cfg.destination}
Departure: ${cfg.departureDisplay}  Return: ${cfg.returnDisplay}

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
    departure = today + relativedelta(months=2)
    ret = departure + timedelta(days=4)
    return departure, ret


def run(
    playwright: Playwright,
    origin: str = "${cfg.origin}",
    destination: str = "${cfg.destination}",
    max_results: int = ${cfg.maxResults},
) -> list:
    departure, return_date = compute_dates()
    dep_str = departure.strftime("%Y-%m-%d")
    ret_str = return_date.strftime("%Y-%m-%d")
    dep_display = departure.strftime("%m/%d/%Y")
    ret_display = return_date.strftime("%m/%d/%Y")

    print(f"  {origin} → {destination}")
    print(f"  Departure: {dep_display}  Return: {ret_display}\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("flights_google_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Google Flights...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss cookie/consent banners ────────────────────────────────
        for selector in [
            "button:has-text('Accept all')",
            "button:has-text('I agree')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 1: Ensure Round Trip ─────────────────────────────────────
        print("STEP 1: Ensuring Round Trip...")
        try:
            # Use JS to check the current trip type without opening dropdown
            trip_text = page.evaluate('''() => {
                const spans = document.querySelectorAll('span');
                for (const s of spans) {
                    const t = s.innerText.trim().toLowerCase();
                    if (t === 'round trip' || t === 'one way' || t === 'multi-city') {
                        return t;
                    }
                }
                return '';
            }''')
            if 'round trip' in trip_text:
                print("  Already Round Trip")
            else:
                trip_btn = page.locator(
                    '[aria-label*="trip" i], '
                    'button:has-text("One way"), '
                    'button:has-text("Multi-city")'
                ).first
                trip_btn.evaluate("el => el.click()")
                page.wait_for_timeout(500)
                page.locator('li:has-text("Round trip"), [data-value="1"]').first.evaluate("el => el.click()")
                page.wait_for_timeout(500)
                print("  Selected Round Trip")
        except Exception as e:
            print(f"  Round Trip check skipped: {e}")

        # ── STEP 2: Set Origin ────────────────────────────────────────────
        print(f'STEP 2: Origin = "{origin}"...')
        try:
            # Click on the origin input area
            origin_el = page.locator(
                'div[aria-label*="Where from" i], '
                'input[aria-label*="Where from" i]'
            ).first
            origin_el.evaluate("el => el.click()")
            page.wait_for_timeout(500)

            # Clear and type
            page.keyboard.press("Control+a")
            page.wait_for_timeout(200)
            page.keyboard.type(origin, delay=50)
            print(f'  Typed "{origin}"')
            page.wait_for_timeout(1500)

            # Select first suggestion from autocomplete
            try:
                suggestion = page.locator('ul[role="listbox"] li').first
                suggestion.wait_for(state="visible", timeout=5000)
                suggestion.evaluate("el => el.click()")
                print("  Selected origin suggestion")
            except Exception:
                page.keyboard.press("Enter")
                print("  Pressed Enter (no dropdown)")
            page.wait_for_timeout(1000)
        except Exception as e:
            print(f"  Origin input issue: {e}")

        # ── STEP 3: Set Destination ───────────────────────────────────────
        print(f'STEP 3: Destination = "{destination}"...')
        try:
            # After origin, Google Flights often auto-focuses destination.
            # Check if destination input is focused already.
            dest_focused = page.evaluate('''() => {
                const el = document.activeElement;
                if (el && el.tagName === 'INPUT') {
                    const ph = (el.placeholder || '').toLowerCase();
                    const lbl = (el.getAttribute('aria-label') || '').toLowerCase();
                    return ph.includes('where to') || lbl.includes('where to');
                }
                return false;
            }''')

            if dest_focused:
                print("  Destination auto-focused after origin")
            else:
                # Click destination — try visible input via JS
                clicked = page.evaluate('''() => {
                    const inputs = document.querySelectorAll('input[role="combobox"]');
                    for (const inp of inputs) {
                        const ph = (inp.placeholder || '').toLowerCase();
                        const lbl = (inp.getAttribute('aria-label') || '').toLowerCase();
                        if (ph.includes('where to') || lbl.includes('where to')) {
                            const rect = inp.getBoundingClientRect();
                            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
                                inp.focus();
                                inp.click();
                                return true;
                            }
                        }
                    }
                    return false;
                }''')
                if clicked:
                    print("  Clicked destination input via JS")
                else:
                    page.locator(
                        'input[aria-label*="Where to" i]'
                    ).first.evaluate("el => el.click()")
                    print("  Force-clicked destination input")

            page.wait_for_timeout(500)
            page.keyboard.press("Control+a")
            page.wait_for_timeout(200)
            page.keyboard.type(destination, delay=50)
            print(f'  Typed "{destination}"')
            page.wait_for_timeout(1500)

            try:
                suggestion = page.locator('ul[role="listbox"] li').first
                suggestion.wait_for(state="visible", timeout=5000)
                suggestion.evaluate("el => el.click()")
                print("  Selected destination suggestion")
            except Exception:
                page.keyboard.press("Enter")
                print("  Pressed Enter (no dropdown)")
            page.wait_for_timeout(1000)
        except Exception as e:
            print(f"  Destination input issue: {e}")

        # ── STEP 4: Set Dates ─────────────────────────────────────────────
        print(f"STEP 4: Dates — Departure: {dep_display}, Return: {ret_display}...")

        # Click the departure date area to open the calendar dialog
        date_opened = False
        for sel in [
            '[aria-label*="Departure" i]',
            'input[placeholder*="Departure" i]',
        ]:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=2000):
                    el.evaluate("el => el.click()")
                    date_opened = True
                    print("  Opened calendar via departure field")
                    break
            except Exception:
                continue
        if not date_opened:
            print("  Could not open calendar")
        page.wait_for_timeout(1500)

        if date_opened:
            # ── Navigate calendar forward until departure month visible ──
            dep_month_label = departure.strftime("%B %Y")
            for _ in range(24):
                cal_text = page.evaluate('''() => {
                    const d = document.querySelector('[role="dialog"]');
                    return d ? d.innerText : '';
                }''') or ''
                if dep_month_label in cal_text:
                    break
                went = page.evaluate('''() => {
                    const d = document.querySelector('[role="dialog"]');
                    if (!d) return false;
                    const btns = d.querySelectorAll('button');
                    for (const b of btns) {
                        const lbl = (b.getAttribute('aria-label') || '').toLowerCase();
                        if (lbl.includes('next')) { b.click(); return true; }
                    }
                    return false;
                }''')
                if not went:
                    break
                page.wait_for_timeout(400)
            print(f"  Calendar shows {dep_month_label}")
            page.wait_for_timeout(500)

            # ── Click departure day on the calendar grid ─────────────────
            dep_day = departure.day
            dep_month_name = departure.strftime("%B")

            dep_clicked = page.evaluate(f'''() => {{
                const candidates = [];
                const btns = document.querySelectorAll('[role="button"]');
                for (const btn of btns) {{
                    const firstLine = (btn.innerText || '').split('\\\\n')[0].trim();
                    if (firstLine === '{dep_day}') {{
                        candidates.push(btn);
                    }}
                }}
                if (candidates.length === 0) return 'no_day_btn';
                for (const btn of candidates) {{
                    let el = btn.parentElement;
                    for (let i = 0; i < 6; i++) {{
                        if (!el) break;
                        if (el.getAttribute('role') === 'rowgroup') {{
                            const txt = (el.innerText || '').split('\\\\n')[0].trim();
                            if (txt === '{dep_month_name}') {{
                                btn.click();
                                return 'clicked';
                            }}
                            break;
                        }}
                        el = el.parentElement;
                    }}
                }}
                return 'no_match';
            }}''')
            if dep_clicked == 'clicked':
                print(f"  Selected departure day {dep_day}")
            else:
                print(f"  WARNING: Could not click departure day {dep_day} ({dep_clicked})")
            page.wait_for_timeout(1000)

            # ── Return date — calendar should still be open ──────────────
            ret_month_label = return_date.strftime("%B %Y")
            if ret_month_label != dep_month_label:
                for _ in range(6):
                    cal_text = page.evaluate('''() => {
                        return document.body.innerText.substring(0, 5000);
                    }''') or ''
                    if ret_month_label in cal_text:
                        break
                    page.evaluate('''() => {
                        const btns = document.querySelectorAll('button');
                        for (const b of btns) {
                            const lbl = (b.getAttribute('aria-label')||'').toLowerCase();
                            if (lbl.includes('next')) { b.click(); return; }
                        }
                    }''')
                    page.wait_for_timeout(400)

            ret_day = return_date.day
            ret_month_name = return_date.strftime("%B")
            ret_clicked = page.evaluate(f'''() => {{
                const candidates = [];
                const btns = document.querySelectorAll('[role="button"]');
                for (const btn of btns) {{
                    const firstLine = (btn.innerText || '').split('\\\\n')[0].trim();
                    if (firstLine === '{ret_day}') {{
                        candidates.push(btn);
                    }}
                }}
                if (candidates.length === 0) return 'no_day_btn';
                for (const btn of candidates) {{
                    let el = btn.parentElement;
                    for (let i = 0; i < 6; i++) {{
                        if (!el) break;
                        if (el.getAttribute('role') === 'rowgroup') {{
                            const txt = (el.innerText || '').split('\\\\n')[0].trim();
                            if (txt === '{ret_month_name}') {{
                                btn.click();
                                return 'clicked';
                            }}
                            break;
                        }}
                        el = el.parentElement;
                    }}
                }}
                return 'no_match';
            }}''')
            if ret_clicked == 'clicked':
                print(f"  Selected return day {ret_day}")
            else:
                print(f"  WARNING: Could not click return day {ret_day} ({ret_clicked})")
            page.wait_for_timeout(500)

        # Click Done if visible
        done_result = page.evaluate('''() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const txt = (b.innerText || '').trim();
                if (txt === 'Done' && b.offsetParent !== null) {
                    b.click();
                    return 'clicked';
                }
            }
            return 'not_found';
        }''')
        print(f"  Done button: {done_result}")
        page.wait_for_timeout(1000)

        # ── STEP 5: Search ────────────────────────────────────────────────
        print("STEP 5: Searching for flights...")
        search_result = page.evaluate('''() => {
            const btns = document.querySelectorAll('button');
            for (const b of btns) {
                const aria = (b.getAttribute('aria-label') || '').toLowerCase();
                const txt = (b.innerText || '').trim().toLowerCase();
                if ((txt === 'search' || aria.includes('search'))
                    && b.offsetParent !== null) {
                    b.click();
                    return 'clicked';
                }
            }
            return 'not_found';
        }''')
        print(f"  Search button: {search_result}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(8000)

        try:
            page.locator('span:has-text("$")').first.wait_for(
                state="visible", timeout=10000
            )
            print("  Results loaded (price found)")
        except Exception:
            print("  Timeout waiting for price — continuing anyway")
        page.evaluate("window.scrollBy(0, 500)")
        page.wait_for_timeout(2000)
        print(f"  URL: {page.url}")

        # ── STEP 6: Extract flights ──────────────────────────────────────
        print(f"STEP 6: Extract up to {max_results} flights...")
        seen_flights = set()

        # Use JS extraction — search for elements containing flight data
        js_flights = page.evaluate('''() => {
            const results = [];
            const candidates = document.querySelectorAll(
                'li, [role="listitem"], div[jsname], div[data-resultid]'
            );
            for (const item of candidates) {
                const text = item.innerText || '';
                if (text.length < 20 || text.length > 300) continue;
                const priceMatch = text.match(/\\$[\\d,]+/);
                if (!priceMatch) continue;
                if (!/\\d{1,2}[:\\u2236]\\d{2}/.test(text)) continue;
                results.push({ text: text, price: priceMatch[0] });
                if (results.length >= 20) break;
            }
            return results;
        }''')
        print(f"  JS found {len(js_flights)} candidate flight items")

        for item in js_flights:
            if len(results) >= max_results:
                break
            card_text = item['text']
            price = item['price']
            lines = [l.strip() for l in card_text.split('\\n') if l.strip()]
            itinerary_parts = []
            for line in lines:
                if re.match(r'^\\$[\\d,]+', line):
                    continue
                if line.lower() in (
                    'round trip', 'economy', 'selected', 'select',
                    'price unavailable', 'nonstop',
                ):
                    continue
                if any(kw in line.lower() for kw in (
                    'top departing', 'ranked based', 'sorted by',
                    'passenger assistance', 'taxes + fees',
                    'optional charges', 'bag fees',
                )):
                    continue
                if re.search(r'kg CO2|% emissions', line):
                    continue
                if re.match(r'^[A-Z]{3}[\\u2013\\-\\u2013][A-Z]{3}$', line):
                    continue
                if len(line) < 3:
                    continue
                itinerary_parts.append(line)
            itinerary = " | ".join(itinerary_parts[:6])
            if not itinerary:
                continue
            flight_key = f"{itinerary}_{price}".lower().strip()
            if flight_key in seen_flights:
                continue
            seen_flights.add(flight_key)
            results.append({"itinerary": itinerary, "price": price})

        # Fallback: text-based extraction
        if not results:
            print("  Structured extraction missed — text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            lines = body_text.split('\\n')
            buf = []
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                pm = re.search(r'\\$[\\d,]+', line)
                if pm:
                    if buf:
                        itinerary = " | ".join(buf[-5:])
                        price = pm.group(0)
                        fk = f"{itinerary}_{price}".lower()
                        if fk not in seen_flights:
                            seen_flights.add(fk)
                            results.append({
                                "itinerary": itinerary,
                                "price": price,
                            })
                            if len(results) >= max_results:
                                break
                    buf = []
                else:
                    buf.append(line)

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} flights ({origin} → {destination}):")
        print(f"  Departure: {dep_display}  Return: {ret_display}\\n")
        for i, flight in enumerate(results, 1):
            print(f"  {i}. {flight['itinerary']}")
            print(f"     Price: {flight['price']} (Economy)")

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
        print(f"\\nTotal flights found: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  try {
    for (const text of ["Accept all", "I agree", "Accept", "Got it"]) {
      const btn = page.locator(`button:has-text("${text}")`);
      if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
        await btn.click();
        console.log(`   ✅ Dismissed: "${text}"`);
      }
    }
  } catch (e) { /* no popups */ }
  await page.waitForTimeout(500);
}

async function ensureRoundTrip(stagehand, page, recorder) {
  console.log("🎯 STEP 1: Ensure Round Trip...");
  try {
    await observeAndAct(stagehand, page, recorder,
      `Check the trip type selector. If it does not say "Round trip", click it and select "Round trip" from the dropdown.`,
      "Ensure Round Trip selected"
    );
    console.log("   ✅ Round Trip confirmed");
  } catch (e) {
    // Might already be round trip
    console.log("   ⚠️  Round Trip check skipped:", e.message);
  }
  await page.waitForTimeout(500);
}

async function setOrigin(stagehand, page, recorder, origin) {
  console.log(`🎯 STEP 2: Origin = "${origin}"...`);

  await observeAndAct(stagehand, page, recorder,
    `Click the "Where from?" origin input field`,
    "Click origin input"
  );
  await page.waitForTimeout(500);

  await stagehand.act(`Clear the origin input field and type '${origin}'`);
  console.log(`   ✅ Typed "${origin}"`);
  recorder.record("act", { instruction: `Type '${origin}' into origin`, description: `Fill origin: ${origin}`, method: "type" });

  await page.waitForTimeout(CFG.waits.type);

  // Select first autocomplete suggestion
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the first autocomplete suggestion for the city "${origin}" from the dropdown list`,
      "Select origin suggestion",
      CFG.waits.select
    );
    console.log("   ✅ Selected origin suggestion");
  } catch (e) {
    console.log("   ⚠️  No autocomplete suggestion, pressing Enter");
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function setDestination(stagehand, page, recorder, destination) {
  console.log(`🎯 STEP 3: Destination = "${destination}"...`);

  // After origin selection, destination input may be auto-focused
  const destFocused = await page.evaluate(() => {
    const el = document.activeElement;
    if (el && el.tagName === "INPUT") {
      const ph = (el.placeholder || "").toLowerCase();
      const lbl = (el.getAttribute("aria-label") || "").toLowerCase();
      return ph.includes("where to") || lbl.includes("where to");
    }
    return false;
  });

  if (destFocused) {
    console.log("   Destination auto-focused after origin");
  } else {
    // Try clicking destination via AI observation
    try {
      await observeAndAct(stagehand, page, recorder,
        `Click the "Where to?" destination input field`,
        "Click destination input"
      );
    } catch (e) {
      // Fallback: JS click the visible destination input
      console.log("   Trying JS fallback for destination...");
      await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[role="combobox"]');
        for (const inp of inputs) {
          const ph = (inp.placeholder || "").toLowerCase();
          const lbl = (inp.getAttribute("aria-label") || "").toLowerCase();
          if (ph.includes("where to") || lbl.includes("where to")) {
            const rect = inp.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0 && rect.top >= 0) {
              inp.focus();
              inp.click();
              return true;
            }
          }
        }
        return false;
      });
    }
  }
  await page.waitForTimeout(500);

  await stagehand.act(`Clear the destination input field and type '${destination}'`);
  console.log(`   ✅ Typed "${destination}"`);
  recorder.record("act", { instruction: `Type '${destination}' into destination`, description: `Fill destination: ${destination}`, method: "type" });

  await page.waitForTimeout(CFG.waits.type);

  // Select first suggestion
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the first autocomplete suggestion for the city "${destination}" from the dropdown list`,
      "Select destination suggestion",
      CFG.waits.select
    );
    console.log("   ✅ Selected destination suggestion");
  } catch (e) {
    console.log("   ⚠️  No autocomplete suggestion, pressing Enter");
    await page.keyboard.press("Enter");
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function setDates(stagehand, page, recorder, departure, returnDate, departureSlash, returnSlash) {
  console.log(`🎯 STEP 4: Dates — Departure: ${departure}, Return: ${returnDate}...`);

  // Open the departure date field
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the departure date field to open the date picker`,
      "Open departure date picker"
    );
    await page.waitForTimeout(1000);
  } catch (e) {
    console.log("   Calendar may already be open");
  }

  // Type departure date as YYYY/MM/DD and press Enter
  // (per prompt: "The dates can be entered as yyyy/mm/dd <enter>")
  // Stagehand page doesn't expose keyboard directly — use act() for typing
  await stagehand.act(`Select all text in the departure date field, clear it, then type '${departureSlash}' and press Enter`);
  console.log(`   ✅ Entered departure: ${departureSlash}`);
  recorder.record("act", { instruction: `Enter departure date ${departureSlash}`, description: "Type departure date", method: "type" });
  await page.waitForTimeout(1000);

  // Click the return date field
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the return date field to enter the return date`,
      "Click return date field"
    );
    await page.waitForTimeout(500);
  } catch (e) {
    console.log("   Return field may already be focused");
  }

  // Type return date
  await stagehand.act(`Select all text in the return date field, clear it, then type '${returnSlash}' and press Enter`);
  console.log(`   ✅ Entered return: ${returnSlash}`);
  recorder.record("act", { instruction: `Enter return date ${returnSlash}`, description: "Type return date", method: "type" });
  await page.waitForTimeout(500);

  // Click Done if visible
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the "Done" button if it is visible on the date picker`,
      "Click Done on calendar",
      2000
    );
    console.log("   ✅ Clicked Done");
    await page.waitForTimeout(1000);
  } catch (e) { /* no Done button */ }
}

async function clickSearch(stagehand, page, recorder) {
  console.log("🎯 STEP 5: Search...");

  await observeAndAct(stagehand, page, recorder,
    `Click the Search button to search for flights`,
    "Click Search button"
  );
  console.log("   ✅ Clicked Search");

  await page.waitForTimeout(CFG.waits.search);
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(CFG.waits.search);
  console.log(`   📍 URL: ${page.url()}`);
}

async function extractFlights(stagehand, page, recorder) {
  console.log(`🎯 STEP 6: Extract up to ${CFG.maxResults} flights...\n`);
  const { z } = require("zod/v3");

  const listings = await stagehand.extract(
    `Extract up to ${CFG.maxResults} round-trip flight results from the search results page. For each flight, get the itinerary summary (airline, departure time, arrival time, duration, number of stops) and the economy class price (e.g. '$189'). Only extract real flight results, not ads or sponsored results.`,
    z.object({
      flights: z.array(z.object({
        itinerary: z.string().describe("Flight itinerary: airline, times, duration, stops"),
        price: z.string().describe("Economy class price, e.g. '$189'"),
      })).describe(`Up to ${CFG.maxResults} flights`),
    })
  );

  recorder.record("extract", {
    instruction: "Extract flight search results",
    description: `Extract up to ${CFG.maxResults} flights`,
    results: listings,
  });

  console.log(`📋 Found ${listings.flights.length} flights:`);
  listings.flights.forEach((f, i) => {
    console.log(`   ${i + 1}. ${f.itinerary}`);
    console.log(`      💰 Price: ${f.price} (Economy)`);
  });

  return listings;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Google Flights – Round Trip Flight Search");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  ✈️  ${CFG.origin} → ${CFG.destination}`);
  console.log(`  📅 Departure: ${CFG.departureDisplay}  Return: ${CFG.returnDisplay}\n`);

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
    console.log("🌐 Loading Google Flights...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    await dismissPopups(page);
    await ensureRoundTrip(stagehand, page, recorder);
    await setOrigin(stagehand, page, recorder, CFG.origin);
    await setDestination(stagehand, page, recorder, CFG.destination);
    await setDates(stagehand, page, recorder, CFG.departure, CFG.returnDate, CFG.departureSlash, CFG.returnSlash);
    await clickSearch(stagehand, page, recorder);

    const listings = await extractFlights(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${listings.flights.length} flights found`);
    console.log("═══════════════════════════════════════════════════════════");
    listings.flights.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.itinerary} — ${f.price}`);
    });

    // Save Python + JSON
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "flights_search.py");
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
      fs.writeFileSync(path.join(__dirname, "flights_search.py"), pyScript, "utf-8");
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
