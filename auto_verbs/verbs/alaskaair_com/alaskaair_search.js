const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Alaska Airlines – Round Trip Flight Search (v6)
 *
 * Uses page.evaluate() for Shadow DOM traversal + page.click(x,y) & page.type()
 * for form filling, then stagehand.extract() for results.
 *
 * Stagehand Page API:
 *   page.evaluate(expr, arg)       — run JS in browser
 *   page.click(x, y)               — click at screen coordinates
 *   page.type(text, {delay})       — type text into focused element
 *   page.keyPress("Control+a")     — key combo
 *   page.goto(url), page.url(), page.waitForTimeout(ms), page.waitForLoadState()
 */

// ── Deep Shadow DOM helper (evaluated in browser) ────────────────────────────
const DEEP_QUERY = `
function deepQuerySelectorAll(root, selector) {
  let results = Array.from(root.querySelectorAll(selector));
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      results = results.concat(deepQuerySelectorAll(el.shadowRoot, selector));
    }
  }
  return results;
}
`;

// ── Date Computation ─────────────────────────────────────────────────────────
function computeDates() {
  const today = new Date();
  const dep = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const ret = new Date(dep); ret.setDate(ret.getDate() + 4);
  const fmt = (d) => `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  return { departure: fmt(dep), ret: fmt(ret) };
}
const dates = computeDates();

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.alaskaair.com",
  from: "Seattle",
  to: "Chicago",
  depDate: dates.departure,
  retDate: dates.ret,
  maxResults: 5,
  waits: { page: 5000, type: 2000, select: 1500, search: 12000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Alaska Airlines – Round Trip Flight Search
From: ${cfg.from} → To: ${cfg.to}
Departure: ${cfg.depDate}  Return: ${cfg.retDate}

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with built-in shadow DOM piercing
(no coordinate math or page.evaluate hacks required).
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
    return departure.strftime("%m/%d/%Y"), ret.strftime("%m/%d/%Y")


def run(
    playwright: Playwright,
    origin: str = "${cfg.from}",
    destination: str = "${cfg.to}",
    departure_date: str = None,
    return_date: str = None,
    max_results: int = ${cfg.maxResults},
) -> list:
    if departure_date is None or return_date is None:
        departure_date, return_date = compute_dates()

    print(f"  ${cfg.from} -> ${cfg.to}")
    print(f"  Dep: {departure_date}  Ret: {return_date}\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("alaskaair_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Alaska Airlines...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups ────────────────────────────────────────────────
        for label in ["close", "dismiss", "accept", "got it"]:
            try:
                btn = page.get_by_role("button", name=re.compile(label, re.IGNORECASE))
                if btn.first.is_visible(timeout=1000):
                    btn.first.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
                    break
            except Exception:
                pass

        # ── Round Trip ────────────────────────────────────────────────────
        # Alaska Airlines defaults to Round Trip. We verify and only click
        # if needed, using a narrow locator to avoid matching unrelated radios.
        print("STEP 2: Ensuring Round Trip...")
        try:
            # Look for the booking widget's trip-type radio inside the
            # borealis booking component (avoids matching other page radios).
            booking = page.locator(
                "borealis-expanded-booking-widget, "
                "[class*='booking'], [class*='planbook']"
            ).first
            rt_radio = booking.get_by_text("Round trip", exact=False).first
            if rt_radio.is_visible(timeout=2000):
                rt_radio.evaluate("el => el.click()")
                print("  Selected Round Trip (booking widget text)")
            else:
                raise Exception("not visible")
        except Exception:
            # Round trip is the default — just verify it's already selected
            print("  Round trip is the default; skipping click")
        page.wait_for_timeout(500)

        # ── Fill Origin ───────────────────────────────────────────────────
        print(f'STEP 3: Origin = "{origin}"...')
        from_input = page.locator('input[role="combobox"]').first
        from_input.focus()
        print("  Focused From combobox")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(origin, delay=50)
        print(f'  Typed "{origin}"')
        page.wait_for_timeout(2000)

        # Select first suggestion
        option_count = page.locator('[role="option"]').count()
        print(f"  Options found by locator: {option_count}")
        try:
            option = page.locator('[role="option"], auro-menuoption').first
            option.wait_for(state="attached", timeout=5000)
            opt_text = option.inner_text()
            option.evaluate("el => el.click()")
            print(f"  Selected: {opt_text.strip()[:80]}")
        except Exception:
            # Enter accepts the first/highlighted suggestion
            page.keyboard.press("Enter")
            print("  No option locator found, pressed Enter")
        page.wait_for_timeout(1500)

        # ── Fill Destination ──────────────────────────────────────────────
        print(f'STEP 4: Destination = "{destination}"...')
        # Tab twice: first Tab lands on the swap/switch-direction button,
        # second Tab reaches the destination combobox.
        page.keyboard.press("Tab")
        page.wait_for_timeout(300)
        page.keyboard.press("Tab")
        page.wait_for_timeout(500)
        print("  Tabbed to To combobox (2x Tab, skipping swap button)")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(destination, delay=50)
        print(f'  Typed "{destination}"')
        page.wait_for_timeout(2000)

        # Select first suggestion
        option_count = page.locator('[role="option"]').count()
        print(f"  Options found by locator: {option_count}")
        try:
            option = page.locator('[role="option"], auro-menuoption').first
            option.wait_for(state="attached", timeout=5000)
            opt_text = option.inner_text()
            option.evaluate("el => el.click()")
            print(f"  Selected: {opt_text.strip()[:80]}")
        except Exception:
            page.keyboard.press("Enter")
            print("  No option locator found, pressed Enter")
        page.wait_for_timeout(1500)

        # ── Fill Dates ────────────────────────────────────────────────────
        print(f"STEP 5: Dates — Dep: {departure_date}, Ret: {return_date}...")

        dep_input = page.get_by_placeholder("MM/DD/YYYY").first
        dep_input.focus()
        print("  Focused departure date input")
        page.wait_for_timeout(800)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(departure_date, delay=30)
        print(f"  Typed departure: {departure_date}")
        page.wait_for_timeout(1000)

        # Tab to return date, then type
        page.keyboard.press("Tab")
        page.wait_for_timeout(800)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(return_date, delay=30)
        print(f"  Typed return: {return_date}")
        page.wait_for_timeout(1000)

        # Verify form values
        comboboxes = page.locator('input[role="combobox"]')
        dates = page.get_by_placeholder("MM/DD/YYYY")
        print("  Form state:")
        print(f'    Origin  = "{comboboxes.first.input_value()}"')
        print(f'    Dest    = "{comboboxes.nth(1).input_value()}"')
        print(f'    Depart  = "{dates.first.input_value()}"')
        print(f'    Return  = "{dates.nth(1).input_value()}"')

        # Close date picker
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # ── Click Search Flights ──────────────────────────────────────────
        print("STEP 6: Search flights...")
        search_btn = None

        # Strategy A: planbook-button custom element with "search flights" text
        try:
            loc = page.locator("planbook-button").filter(
                has_text=re.compile("search flights", re.IGNORECASE)
            )
            if loc.first.is_visible(timeout=3000):
                search_btn = loc.first
                print("  Found <planbook-button> via locator")
        except Exception:
            pass

        # Strategy B: auro-button with search text
        if search_btn is None:
            try:
                loc = page.locator("auro-button").filter(
                    has_text=re.compile("search flights", re.IGNORECASE)
                )
                if loc.first.is_visible(timeout=2000):
                    search_btn = loc.first
                    print("  Found <auro-button> via locator")
            except Exception:
                pass

        # Strategy C: any button by role + name
        if search_btn is None:
            try:
                loc = page.get_by_role("button", name=re.compile("search flights", re.IGNORECASE))
                if loc.first.is_visible(timeout=2000):
                    search_btn = loc.first
                    print("  Found button by role")
            except Exception:
                pass

        if search_btn:
            search_btn.scroll_into_view_if_needed()
            page.wait_for_timeout(300)
            search_btn.evaluate("el => el.click()")
            print("  Clicked search button")
        else:
            print("  ERROR: Search button not found — trying text fallback")
            page.get_by_text("Search flights", exact=False).first.evaluate("el => el.click()")

        # Wait for navigation
        start_url = page.url
        try:
            page.wait_for_url("**/search/results**", timeout=15000)
            print(f"  Navigated to: {page.url}")
        except Exception:
            print(f"  URL after wait: {page.url}")
            if page.url == start_url and search_btn:
                print("  Retrying click...")
                search_btn.evaluate("el => el.click()")
                try:
                    page.wait_for_url("**/search/results**", timeout=15000)
                    print(f"  Navigated on retry: {page.url}")
                except Exception:
                    print(f"  URL after retry: {page.url}")

        if "search/results" in page.url:
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(5000)

        # ── Extract flights ───────────────────────────────────────────────
        print(f"STEP 7: Extract up to {max_results} flights...")
        print(f"  URL: {page.url}")

        body_text = page.evaluate("document.body.innerText") or ""

        dollar_matches = re.findall(r"\\$\\d[\\d,]*", body_text)
        if dollar_matches:
            print(f"  Found {len(dollar_matches)} price-like strings")

        # Locator-based extraction: look for result rows
        flight_rows = page.locator(
            "[class*='flight-row'], [class*='FlightRow'], "
            "[data-testid*='flight'], [class*='option-row'], [role='row']"
        )
        count = flight_rows.count()
        if count == 0:
            flight_rows = page.locator(
                "[class*='fare'], [class*='itinerary'], "
                "[class*='result'], li[class*='flight']"
            )
            count = flight_rows.count()

        print(f"  Locator found {count} flight rows")

        for i in range(count):
            if len(results) >= max_results:
                break
            row = flight_rows.nth(i)
            try:
                row_text = row.inner_text(timeout=3000)
                lines = [l.strip() for l in row_text.split("\\n") if l.strip()]
                itinerary = " | ".join(lines[:3]) if len(lines) >= 3 else " | ".join(lines)
                price = "N/A"
                for line in lines:
                    pm = re.search(r"\\$[\\d,]+", line)
                    if pm:
                        price = pm.group(0)
                        break
                # Skip duplicate/expansion rows that have no price
                if price == "N/A":
                    continue
                results.append({"itinerary": itinerary, "price": price})
            except Exception:
                continue

        # Fallback: regex on body text — flight number pattern
        if not results and dollar_matches:
            print("  Using regex fallback (flight number pattern)...")
            lines = body_text.split("\\n")
            i = 0
            while i < len(lines) and len(results) < max_results:
                line = lines[i].strip()
                if re.match(r"AS\\s+\\d{1,4}$", line):
                    itin_lines = [line]
                    j = i + 1
                    price = "N/A"
                    while j < min(i + 10, len(lines)):
                        l = lines[j].strip()
                        if not l:
                            j += 1
                            continue
                        pm = re.search(r"\\$[\\d,]+", l)
                        if pm:
                            price = pm.group(0)
                            break
                        itin_lines.append(l)
                        j += 1
                    if price != "N/A":
                        results.append({
                            "itinerary": " | ".join(itin_lines[:5]),
                            "price": price,
                        })
                i += 1

        # Fallback 2: simple dollar-context regex
        if not results and dollar_matches:
            print("  Using dollar-context fallback...")
            for m in re.finditer(r"(.{0,100})(\\$\\d[\\d,]*)", body_text, re.DOTALL):
                ctx = m.group(1).strip().split("\\n")
                price = m.group(2)
                itin = " ".join(ctx[-3:]) if len(ctx) >= 3 else " ".join(ctx)
                results.append({"itinerary": itin.strip(), "price": price})
                if len(results) >= max_results:
                    break

        print(f"\\nFound {len(results)} flights from '{origin}' to '{destination}':")
        print(f"  Departure: {departure_date}  Return: {return_date}\\n")
        for i, item in enumerate(results, 1):
            print(f"  {i}. Itinerary: {item['itinerary']}")
            print(f"     Economy Price: {item['price']}")

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

// ── Helper: find element via shadow DOM, get center coords ───────────────────
async function findAndGetCenter(page, jsExpr) {
  return await page.evaluate(jsExpr);
}

// ── Helper: click element found in shadow DOM by its coords ──────────────────
async function clickShadowElement(page, jsExpr, description) {
  const result = await page.evaluate(jsExpr);
  if (result && result.x != null) {
    console.log(`   ✅ ${description} (at ${Math.round(result.x)},${Math.round(result.y)})`);
    return true;
  }
  console.log(`   ❌ ${description} - element not found`);
  return false;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  try {
    await page.evaluate(`(() => {
      ${DEEP_QUERY}
      const btns = deepQuerySelectorAll(document, 'button');
      for (const btn of btns) {
        const lbl = (btn.getAttribute('aria-label') || btn.textContent || '').toLowerCase();
        if (lbl.includes('close') || lbl.includes('dismiss') || lbl.includes('accept') || lbl.includes('got it')) {
          if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
            btn.click(); return true;
          }
        }
      }
      return false;
    })()`);
  } catch (e) { /* no popup */ }
  await page.waitForTimeout(1000);
}

async function ensureRoundTrip(page, recorder) {
  console.log("🎯 STEP 2: Ensuring Round Trip...");
  try {
    const result = await page.evaluate(`(() => {
      ${DEEP_QUERY}
      const radios = deepQuerySelectorAll(document, 'input[type="radio"], [role="radio"]');
      for (const r of radios) {
        const lbl = (r.getAttribute('aria-label') || r.textContent || r.getAttribute('value') || '').toLowerCase();
        if (lbl.includes('round')) { r.click(); return { found: true, label: lbl }; }
      }
      const labels = deepQuerySelectorAll(document, 'label');
      for (const l of labels) {
        if (l.textContent.toLowerCase().includes('round trip')) { l.click(); return { found: true, label: l.textContent.trim() }; }
      }
      return { found: false };
    })()`);
    console.log(result.found ? `   ✅ Selected Round Trip` : `   ⚠️  Assuming default`);
    if (result.found) recorder.record("act", { instruction: "Select Round trip", description: "Select Round Trip", method: "click" });
  } catch (e) {
    console.log(`   ⚠️  ${e.message.split("\n")[0]}`);
  }
  await page.waitForTimeout(500);
}

async function fillOrigin(page, recorder, city) {
  console.log(`🎯 STEP 3: Origin = "${city}"...`);

  // Probe all visible inputs
  const probe = await page.evaluate(`(() => {
    ${DEEP_QUERY}
    const inputs = deepQuerySelectorAll(document, 'input');
    return inputs.map(inp => ({
      role: inp.getAttribute('role'),
      ariaLabel: inp.getAttribute('aria-label'),
      placeholder: inp.getAttribute('placeholder'),
      type: inp.type,
      value: inp.value,
      visible: inp.offsetParent !== null || inp.getClientRects().length > 0,
    })).filter(x => x.visible);
  })()`);
  console.log(`   📋 ${probe.length} visible inputs:`);
  probe.forEach((p, i) => console.log(`      [${i}] role=${p.role} placeholder="${p.placeholder}" type=${p.type} value="${p.value}"`));

  // Click first combobox (From) — focus + click via evaluate, then get coords
  const coords = await page.evaluate(`(() => {
    ${DEEP_QUERY}
    const inputs = deepQuerySelectorAll(document, 'input[role="combobox"]');
    const vis = inputs.filter(i => i.offsetParent !== null || i.getClientRects().length > 0);
    if (vis.length > 0) {
      vis[0].scrollIntoView({ block: 'center' });
      vis[0].focus();
      const r = vis[0].getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }
    return null;
  })()`);

  if (coords) {
    // Click via page.click(x,y) to trigger any event listeners on the element
    await page.click(coords.x, coords.y);
    console.log(`   ✅ Clicked From combobox at (${Math.round(coords.x)}, ${Math.round(coords.y)})`);
  } else {
    console.log("   ❌ From combobox not found!");
    return;
  }

  await page.waitForTimeout(500);

  // Clear and type
  await page.keyPress("Control+a");
  await page.keyPress("Backspace");
  await page.type(city, { delay: 50 });
  console.log(`   ✅ Typed "${city}"`);
  recorder.record("act", { instruction: `Type '${city}' into From`, description: `Fill origin: ${city}`, method: "type" });

  await page.waitForTimeout(CFG.waits.type);

  // Select first suggestion
  const suggestCoords = await page.evaluate(`(() => {
    ${DEEP_QUERY}
    const opts = deepQuerySelectorAll(document, '[role="option"]');
    const vis = opts.filter(o => o.offsetParent !== null || o.getClientRects().length > 0);
    if (vis.length > 0) {
      const r = vis[0].getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, text: vis[0].textContent.trim().substring(0, 80) };
    }
    // Fallback
    const items = deepQuerySelectorAll(document, 'auro-menuoption, [role="listbox"] li');
    const v = items.filter(o => o.offsetParent !== null || o.getClientRects().length > 0);
    if (v.length > 0) {
      const r = v[0].getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, text: v[0].textContent.trim().substring(0, 80) };
    }
    return null;
  })()`);

  if (suggestCoords) {
    await page.click(suggestCoords.x, suggestCoords.y);
    console.log(`   ✅ Selected: ${suggestCoords.text}`);
    recorder.record("act", { instruction: `Select suggestion for ${city}`, description: "Select origin", method: "click" });
  } else {
    console.log("   ⚠️  No suggestion, pressing Enter");
    await page.keyPress("Enter");
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function fillDestination(page, recorder, city) {
  console.log(`🎯 STEP 4: Destination = "${city}"...`);

  // Click second combobox (To)
  const coords = await page.evaluate(`(() => {
    ${DEEP_QUERY}
    const inputs = deepQuerySelectorAll(document, 'input[role="combobox"]');
    const vis = inputs.filter(i => i.offsetParent !== null || i.getClientRects().length > 0);
    if (vis.length >= 2) {
      vis[1].scrollIntoView({ block: 'center' });
      vis[1].focus();
      const r = vis[1].getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 };
    }
    return null;
  })()`);

  if (coords) {
    await page.click(coords.x, coords.y);
    console.log(`   ✅ Clicked To combobox at (${Math.round(coords.x)}, ${Math.round(coords.y)})`);
  } else {
    console.log("   ❌ To combobox not found!");
    return;
  }

  await page.waitForTimeout(500);

  await page.keyPress("Control+a");
  await page.keyPress("Backspace");
  await page.type(city, { delay: 50 });
  console.log(`   ✅ Typed "${city}"`);
  recorder.record("act", { instruction: `Type '${city}' into To`, description: `Fill destination: ${city}`, method: "type" });

  await page.waitForTimeout(CFG.waits.type);

  const suggestCoords = await page.evaluate(`(() => {
    ${DEEP_QUERY}
    const opts = deepQuerySelectorAll(document, '[role="option"]');
    const vis = opts.filter(o => o.offsetParent !== null || o.getClientRects().length > 0);
    if (vis.length > 0) {
      const r = vis[0].getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, text: vis[0].textContent.trim().substring(0, 80) };
    }
    const items = deepQuerySelectorAll(document, 'auro-menuoption, [role="listbox"] li');
    const v = items.filter(o => o.offsetParent !== null || o.getClientRects().length > 0);
    if (v.length > 0) {
      const r = v[0].getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2, text: v[0].textContent.trim().substring(0, 80) };
    }
    return null;
  })()`);

  if (suggestCoords) {
    await page.click(suggestCoords.x, suggestCoords.y);
    console.log(`   ✅ Selected: ${suggestCoords.text}`);
    recorder.record("act", { instruction: `Select suggestion for ${city}`, description: "Select destination", method: "click" });
  } else {
    console.log("   ⚠️  No suggestion, pressing Enter");
    await page.keyPress("Enter");
  }
  await page.waitForTimeout(CFG.waits.select);
}

async function fillDates(page, recorder, depDate, retDate) {
  console.log(`🎯 STEP 5: Dates — Dep: ${depDate}, Ret: ${retDate}...`);

  // Find all date-related inputs (broader search including date-picker containers)
  const dateInfo = await page.evaluate(`(() => {
    ${DEEP_QUERY}
    // Look for date inputs using multiple strategies
    const inputs = deepQuerySelectorAll(document, 'input');
    const results = [];
    for (const inp of inputs) {
      if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
      if (inp.getAttribute('role') === 'combobox') continue;
      if (['hidden','checkbox','radio','submit'].includes(inp.type)) continue;
      const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
      const val = inp.value || '';
      const id = (inp.id || '').toLowerCase();
      const name = (inp.getAttribute('name') || '').toLowerCase();
      const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
      if (ph.includes('mm/dd') || ph.includes('date') || val.includes('/') || id.includes('date') || name.includes('date') || ariaLabel.includes('date') || ariaLabel.includes('depart') || ariaLabel.includes('return')) {
        const r = inp.getBoundingClientRect();
        results.push({
          placeholder: inp.getAttribute('placeholder'),
          value: val, type: inp.type,
          id: inp.id, name: inp.getAttribute('name'),
          ariaLabel: inp.getAttribute('aria-label'),
          x: r.x + r.width/2, y: r.y + r.height/2,
          w: r.width, h: r.height,
        });
      }
    }
    return results;
  })()`);

  console.log(`   📋 ${dateInfo.length} date inputs found:`);
  dateInfo.forEach((d, i) => console.log(`      [${i}] id="${d.id}" aria="${d.ariaLabel}" placeholder="${d.placeholder}" value="${d.value}" at (${Math.round(d.x)}, ${Math.round(d.y)}) ${d.w}x${d.h}`));

  // Strategy: Click the first date input, type departure, then Tab to return
  if (dateInfo.length >= 1) {
    // Click departure date
    await page.click(dateInfo[0].x, dateInfo[0].y);
    console.log(`   ✅ Clicked departure date at (${Math.round(dateInfo[0].x)}, ${Math.round(dateInfo[0].y)})`);
    await page.waitForTimeout(800);

    // Try to dismiss any calendar popup that appeared (Escape or click away first)
    // Some date pickers open a calendar on click — we need to type in the input directly
    // Try selecting all + delete first
    await page.keyPress("Control+a");
    await page.keyPress("Backspace");
    await page.type(depDate, { delay: 30 });
    console.log(`   ✅ Typed departure: ${depDate}`);
    recorder.record("act", { instruction: `Type departure: ${depDate}`, description: "Fill departure date", method: "type" });
    await page.waitForTimeout(1000);

    // Verify departure date was entered
    const depVal = await page.evaluate(`(() => {
      ${DEEP_QUERY}
      const inputs = deepQuerySelectorAll(document, 'input');
      for (const inp of inputs) {
        if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
        if (inp.getAttribute('role') === 'combobox') continue;
        if (['hidden','checkbox','radio','submit'].includes(inp.type)) continue;
        const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
        if (ph.includes('mm/dd')) return inp.value;
      }
      return null;
    })()`);
    console.log(`   📋 Departure value after typing: "${depVal}"`);

    // Tab to return date
    await page.keyPress("Tab");
    await page.waitForTimeout(800);
    await page.keyPress("Control+a");
    await page.keyPress("Backspace");
    await page.type(retDate, { delay: 30 });
    console.log(`   ✅ Typed return: ${retDate}`);
    recorder.record("act", { instruction: `Type return: ${retDate}`, description: "Fill return date", method: "type" });
    await page.waitForTimeout(1000);

    // If Tab didn't work and there are 2 distinct date inputs, try clicking second
    if (dateInfo.length >= 2 && Math.abs(dateInfo[0].x - dateInfo[1].x) > 20) {
      // Only retry if coordinates are different enough
      const retVal = await page.evaluate(`(() => {
        ${DEEP_QUERY}
        const inputs = deepQuerySelectorAll(document, 'input');
        const dateInputs = [];
        for (const inp of inputs) {
          if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
          if (inp.getAttribute('role') === 'combobox') continue;
          if (['hidden','checkbox','radio','submit'].includes(inp.type)) continue;
          const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
          if (ph.includes('mm/dd')) dateInputs.push(inp.value);
        }
        return dateInputs;
      })()`);
      console.log(`   📋 Date values: ${JSON.stringify(retVal)}`);
    }
  } else {
    console.log("   ❌ No date inputs found");
  }

  // Close date picker if open
  try {
    const doneBtnCoords = await page.evaluate(`(() => {
      ${DEEP_QUERY}
      const btns = deepQuerySelectorAll(document, 'button');
      for (const btn of btns) {
        const txt = (btn.textContent || btn.getAttribute('aria-label') || '').toLowerCase();
        if (txt.includes('done') || txt.includes('apply') || txt.includes('close')) {
          if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
            const r = btn.getBoundingClientRect();
            return { x: r.x + r.width/2, y: r.y + r.height/2, text: txt.substring(0, 40) };
          }
        }
      }
      return null;
    })()`);
    if (doneBtnCoords) {
      await page.click(doneBtnCoords.x, doneBtnCoords.y);
      console.log(`   ✅ Closed date picker (${doneBtnCoords.text})`);
    }
  } catch { /* ignore */ }

  // Press Escape to dismiss any popup/calendar
  await page.keyPress("Escape");
  await page.waitForTimeout(500);
}

async function clickSearch(page, recorder) {
  console.log("🎯 STEP 6: Search flights...");

  // The "Search flights" button is a <planbook-button> web component with slotted text.
  // Must scroll into view, get fresh coords, and click.

  const coords = await page.evaluate(`(() => {
    ${DEEP_QUERY}

    // Strategy A: Find auro-button or planbook-button with "search" text
    const customBtns = deepQuerySelectorAll(document, 'auro-button, planbook-button');
    for (const aBtn of customBtns) {
      const txt = (aBtn.textContent || '').toLowerCase().trim();
      if (txt.includes('search') && !txt.includes('all search')) {
        // Scroll into view FIRST
        aBtn.scrollIntoView({ block: 'center', behavior: 'instant' });
        const r = aBtn.getBoundingClientRect();
        if (r.width > 50 && r.height > 20) {
          return { x: r.x + r.width/2, y: r.y + r.height/2, text: txt.substring(0, 50), tag: aBtn.tagName.toLowerCase(), w: Math.round(r.width), h: Math.round(r.height) };
        }
      }
    }

    // Strategy B: Check host element text for inner buttons in shadow DOM
    const btns = deepQuerySelectorAll(document, 'button');
    for (const btn of btns) {
      if (!(btn.offsetParent !== null || btn.getClientRects().length > 0)) continue;
      const r = btn.getBoundingClientRect();
      if (r.width < 100 || r.height < 30) continue;
      const rootNode = btn.getRootNode();
      if (rootNode && rootNode.host) {
        const hostText = (rootNode.host.textContent || '').toLowerCase().trim();
        if (hostText.includes('search') && !hostText.includes('all search')) {
          btn.scrollIntoView({ block: 'center', behavior: 'instant' });
          const r2 = btn.getBoundingClientRect();
          return { x: r2.x + r2.width/2, y: r2.y + r2.height/2, text: hostText.substring(0, 50), tag: rootNode.host.tagName.toLowerCase(), w: Math.round(r2.width), h: Math.round(r2.height) };
        }
      }
    }

    return null;
  })()`);

  // Small delay after scroll to let position stabilize
  await page.waitForTimeout(500);

  if (coords) {
    console.log(`   🎯 Found: <${coords.tag}> "${coords.text}" ${coords.w}x${coords.h} at (${Math.round(coords.x)},${Math.round(coords.y)})`);

    // Re-measure after scroll stabilization
    const freshCoords = await page.evaluate(`(() => {
      ${DEEP_QUERY}
      const customBtns = deepQuerySelectorAll(document, 'auro-button, planbook-button');
      for (const aBtn of customBtns) {
        const txt = (aBtn.textContent || '').toLowerCase().trim();
        if (txt.includes('search') && !txt.includes('all search')) {
          const r = aBtn.getBoundingClientRect();
          return { x: r.x + r.width/2, y: r.y + r.height/2 };
        }
      }
      return null;
    })()`);

    const cx = freshCoords ? freshCoords.x : coords.x;
    const cy = freshCoords ? freshCoords.y : coords.y;
    console.log(`   📍 Click at (${Math.round(cx)}, ${Math.round(cy)})`);

    await page.click(cx, cy);
    console.log(`   ✅ Clicked via page.click()`);
    recorder.record("act", { instruction: "Click Search flights", description: "Click Search flights", method: "click" });
  } else {
    console.log("   ❌ Button not found via custom element search");
  }

  // Wait and check
  await page.waitForTimeout(3000);
  let currentUrl = page.url();
  console.log(`   📍 URL after click: ${currentUrl}`);

  // If page didn't change, try JS click on the host element directly
  if (currentUrl === CFG.url || currentUrl === CFG.url + '/') {
    console.log("   🔄 CDP click didn't navigate. Trying JS click on host element...");
    const jsClickResult = await page.evaluate(`(() => {
      ${DEEP_QUERY}
      // Find planbook-button or auro-button with "search"
      const customBtns = deepQuerySelectorAll(document, 'planbook-button, auro-button');
      for (const btn of customBtns) {
        const txt = (btn.textContent || '').toLowerCase().trim();
        if (txt.includes('search') && !txt.includes('all search')) {
          // Click the host element
          btn.click();
          // Also try clicking the inner button in shadow DOM
          if (btn.shadowRoot) {
            const innerBtn = btn.shadowRoot.querySelector('button');
            if (innerBtn) {
              innerBtn.click();
              innerBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, composed: true }));
            }
          }
          return { clicked: true, tag: btn.tagName };
        }
      }
      return { clicked: false };
    })()`);
    console.log(`   📋 JS click result: ${JSON.stringify(jsClickResult)}`);
    await page.waitForTimeout(5000);
    currentUrl = page.url();
    console.log(`   📍 URL after JS click: ${currentUrl}`);
  }

  // If still no change, try multiple fallback approaches
  if (currentUrl === CFG.url || currentUrl === CFG.url + '/') {
    console.log("   🔄 Still no navigation. Trying form submit / dispatchEvent...");

    // Try submitting the form containing the search button
    await page.evaluate(`(() => {
      ${DEEP_QUERY}
      // Method 1: Find and submit any form
      const forms = deepQuerySelectorAll(document, 'form');
      for (const f of forms) { try { f.submit(); return 'form'; } catch(e) {} }
      // Method 2: Dispatch submit event on booking widget
      const widgets = deepQuerySelectorAll(document, 'borealis-expanded-booking-widget');
      for (const w of widgets) {
        w.dispatchEvent(new Event('submit', { bubbles: true }));
      }
      // Method 3: Find and click ANY element with "search" in its accessible name
      const all = deepQuerySelectorAll(document, '*');
      for (const el of all) {
        if (!(el.offsetParent !== null || el.getClientRects().length > 0)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 100 || r.height < 20) continue;
        const txt = (el.textContent || '').toLowerCase().trim();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        if ((txt === 'search flights' || aria === 'search flights') && el.tagName !== 'A') {
          el.click();
          return 'wildcard-' + el.tagName;
        }
      }
      return 'none';
    })()`);
    await page.waitForTimeout(10000);
    currentUrl = page.url();
    console.log(`   📍 URL after fallback: ${currentUrl}`);
  }

  console.log("⏳ Waiting for results to load...");
  recorder.wait(CFG.waits.search, "Wait for results");

  if (currentUrl !== CFG.url && currentUrl !== CFG.url + '/') {
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(5000);
  }
}

async function extractResults(stagehand, page, recorder) {
  console.log(`🎯 STEP 7: Extract up to ${CFG.maxResults} flights...\n`);
  const { z } = require("zod/v3");

  console.log(`   📍 URL: ${page.url()}`);

  const listings = await stagehand.extract(
    `Extract up to ${CFG.maxResults} departure flight results. For each flight get the full itinerary (departure time, arrival time, stops, duration, route) and economy class price. Only real flights, not ads.`,
    z.object({
      flights: z.array(z.object({
        itinerary: z.string().describe("Full itinerary: times, stops, duration, route"),
        economyPrice: z.string().describe("Economy price like '$199'"),
      })).describe(`Up to ${CFG.maxResults} flights`),
    })
  );

  recorder.record("extract", {
    instruction: "Extract flight results",
    description: `Extract up to ${CFG.maxResults} flights`,
    results: listings,
  });

  console.log(`📋 Found ${listings.flights.length} flights:`);
  listings.flights.forEach((f, i) => {
    console.log(`   ${i + 1}. ${f.itinerary}`);
    console.log(`      💲 ${f.economyPrice}`);
  });

  return listings;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Alaska Airlines – Round Trip Flight Search (v6)");
  console.log("  🔧 page.evaluate + page.click(x,y) + page.type()");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  ✈️  ${CFG.from} → ${CFG.to}`);
  console.log(`  📅 Dep: ${CFG.depDate}  Ret: ${CFG.retDate}\n`);

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
    console.log("🌐 Loading Alaska Airlines...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("networkidle");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    await dismissPopups(page);
    await ensureRoundTrip(page, recorder);
    await fillOrigin(page, recorder, CFG.from);
    await fillDestination(page, recorder, CFG.to);
    await fillDates(page, recorder, CFG.depDate, CFG.retDate);

    // Verify form state before searching
    console.log("🔍 Verifying form state...");
    const formState = await page.evaluate(`(() => {
      ${DEEP_QUERY}
      const inputs = deepQuerySelectorAll(document, 'input');
      const vis = inputs.filter(i => i.offsetParent !== null || i.getClientRects().length > 0);
      return vis.map(i => ({
        role: i.getAttribute('role'),
        placeholder: i.getAttribute('placeholder'),
        type: i.type,
        value: i.value || '',
        id: i.id,
      })).filter(i => i.type !== 'hidden' && i.type !== 'checkbox' && i.type !== 'radio');
    })()`);
    console.log("   📋 Form inputs:");
    formState.forEach((s, i) => console.log(`      [${i}] ${s.role || s.type} = "${s.value}" (ph="${s.placeholder}" id="${s.id}")`));

    await clickSearch(page, recorder);

    const listings = await extractResults(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${listings.flights.length} flights found`);
    console.log("═══════════════════════════════════════════════════════════");
    listings.flights.forEach((f, i) => console.log(`  ${i + 1}. ${f.itinerary} — ${f.economyPrice}`));

    // Save Python + JSON
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "alaskaair_search.py");
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
      fs.writeFileSync(path.join(__dirname, "alaskaair_search.py"), pyScript, "utf-8");
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
