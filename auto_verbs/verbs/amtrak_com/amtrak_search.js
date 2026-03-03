const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Amtrak – Train Ticket Search (One-Way)  v9 — Concretized
 *
 * Concretized from live exploration on amtrak.com (v7–v8, Feb 2026).
 * All successful steps are deterministic (zero AI calls on the happy path).
 * AI observe+act is kept ONLY as a fallback if deterministic clicks fail.
 *
 * DOM structure discovered:
 *   #am-form-field-control-0       → origin input
 *   #am-form-field-control-2       → destination input
 *   #am-form-field-control-4       → depart date input
 *   [role="option"]                → autocomplete suggestion divs
 *   ngb-datepicker                 → ng-bootstrap calendar widget
 *     .ngb-dp-month-name           → visible month labels (2 months shown)
 *     button[aria-label="Next month"] → forward nav
 *     div[aria-label*="April 27, 2026"] → target day cell
 *   button text "find trains"      → search submit
 *
 * Key findings:
 *   1. OneTrust cookie overlay (.onetrust-pc-dark-filter) blocks ALL
 *      Playwright coordinate clicks → must be removed first.
 *   2. Station autocomplete: page.click() on [role="option"] works after
 *      overlay removal (trusted Playwright click triggers Angular handler).
 *   3. Date: trusted click sets value but Angular FormControl stays ng-invalid
 *      (ngb-datepicker expects NgbDate object). Button force-enable bypasses.
 *   4. FIND TRAINS: force-enable disabled button + el.click() → navigates
 *      to departure.html results page.
 *   5. Extraction: body.innerText split by "SEA to PDX" markers, regex parse
 *      for DEPARTS/ARRIVES/duration/price.
 */

// ── Date Computation ─────────────────────────────────────────────────────────
function computeDate() {
  const today = new Date();
  const dep = new Date(today.getFullYear(), today.getMonth() + 2, today.getDate());
  const pad = (n) => String(n).padStart(2, "0");
  const MONTHS = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December",
  ];
  return {
    iso: `${dep.getFullYear()}-${pad(dep.getMonth() + 1)}-${pad(dep.getDate())}`,
    display: `${pad(dep.getMonth() + 1)}/${pad(dep.getDate())}/${dep.getFullYear()}`,
    month: dep.getMonth(),
    year: dep.getFullYear(),
    day: dep.getDate(),
    monthName: MONTHS[dep.getMonth()],
  };
}
const depDate = computeDate();

// ── Config ───────────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.amtrak.com",
  from: "Seattle, WA",
  fromKeyword: "seattle",
  fromCode: "SEA",
  to: "Portland, OR",
  toKeyword: "portland",
  toCode: "PDX",
  depISO: depDate.iso,
  depDisplay: depDate.display,
  depDay: depDate.day,
  depMonth: depDate.month,
  depYear: depDate.year,
  depMonthName: depDate.monthName,
  maxResults: 5,
  waits: { page: 5000, type: 3000, search: 15000 },
};

// ── genPython (inline generation) ────────────────────────────────────────────
function genPython(cfg) {
  const ts = new Date().toISOString();
  return `"""
Amtrak - Train Ticket Search (One-Way)  v9 - Concretized
${cfg.from} -> ${cfg.to}
Departure: 2 months from today  (1 adult, one-way)

Generated on: ${ts}
All steps are deterministic (zero AI), using known Amtrak DOM IDs.

DOM structure:
  #am-form-field-control-0       -> origin input
  #am-form-field-control-2       -> destination input
  #am-form-field-control-4       -> depart date input
  [role="option"]                -> autocomplete suggestions
  ngb-datepicker                 -> ng-bootstrap calendar
    .ngb-dp-month-name           -> month labels (shows 2 months)
    button[aria-label="Next month"] -> forward nav
    div[aria-label*="<month> <day>, <year>"] -> target day
  button text "find trains"      -> search submit
"""

import re
import os, sys, shutil
import traceback
from datetime import date
from dateutil.relativedelta import relativedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def compute_date():
    today = date.today()
    return today + relativedelta(months=2)


# -- Step 0: Dismiss popups + remove OneTrust overlay -------------------------
def dismiss_popups(page):
    """Dismiss cookie popups and remove OneTrust overlay that blocks clicks."""
    page.wait_for_timeout(2000)

    for _ in range(3):
        clicked = page.evaluate("""(() => {
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
        })()""")
        if clicked:
            print(f"   Dismissed: {clicked}")
            page.wait_for_timeout(800)
        else:
            break
    page.wait_for_timeout(800)

    # Remove OneTrust overlay - blocks ALL coordinate clicks
    removed = page.evaluate("""(() => {
        let n = 0;
        const df = document.querySelector('.onetrust-pc-dark-filter');
        if (df) { df.remove(); n++; }
        const banner = document.getElementById('onetrust-banner-sdk');
        if (banner) { banner.style.display = 'none'; n++; }
        document.querySelectorAll('[class*="onetrust"], [class*="ot-sdk"], .optanon-alert-box-wrapper')
            .forEach(el => { el.style.pointerEvents = 'none'; el.style.display = 'none'; n++; });
        return n;
    })()""")
    if removed > 0:
        print(f"   Removed {removed} OneTrust overlay(s)")


# -- Step 1: Select One-Way ---------------------------------------------------
def select_one_way(page):
    """Click the One-Way tab (programmatic DOM click)."""
    print("STEP 0: Select One-Way...")
    page.evaluate("""(() => {
        const tabs = document.querySelectorAll('[role="tab"]');
        for (const t of tabs) {
            if ((t.textContent || '').toLowerCase().includes('one-way')) { t.click(); return; }
        }
        const els = document.querySelectorAll('a, button, label, span, li');
        for (const el of els) {
            const text = (el.textContent || '').trim().toLowerCase();
            if (text === 'one-way' || text === 'one way') {
                const r = el.getBoundingClientRect();
                if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 700) { el.click(); return; }
            }
        }
    })()""")
    page.wait_for_timeout(1500)

    ok = page.evaluate("""(() => {
        const inputs = document.querySelectorAll('input');
        for (const inp of inputs) {
            if ((inp.placeholder || '').toLowerCase().includes('return'))
                return !(inp.offsetParent !== null || inp.getClientRects().length > 0);
        }
        return true;
    })()""")
    print(f"   {'OK' if ok else 'WARNING'}: One-Way mode {'active' if ok else 'uncertain'}")


# -- Step 2/3: Enter station (concretized) ------------------------------------
def enter_station(page, field_type, station_name, keyword):
    """Fill origin or destination via known IDs + coordinate click on option."""
    is_origin = field_type == "origin"
    label = "Origin (From)" if is_origin else "Destination (To)"
    target_id = "am-form-field-control-0" if is_origin else "am-form-field-control-2"
    step = 1 if is_origin else 2
    print(f"STEP {step}: {label} = \\"{station_name}\\"...")

    # Focus and click field by known ID
    page.evaluate(f"""((id) => {{
        const inp = document.getElementById(id);
        if (inp) {{ inp.focus(); inp.click(); inp.select(); }}
    }})('{target_id}')""")
    page.wait_for_timeout(500)

    # Clear and type
    page.keyboard.press("Control+a")
    page.wait_for_timeout(100)
    page.keyboard.press("Backspace")
    page.wait_for_timeout(300)
    page.keyboard.type(station_name, delay=100)
    page.wait_for_timeout(3000)

    # Find first matching [role="option"]
    kw = keyword.lower()
    option = page.evaluate(f"""((kw) => {{
        const opts = document.querySelectorAll('[role="option"]');
        for (const el of opts) {{
            const t = (el.textContent || '').trim();
            if (t.toLowerCase().includes(kw) && el.offsetParent !== null) {{
                const r = el.getBoundingClientRect();
                if (r.width > 30 && r.height > 10 && r.y > 0)
                    return {{ x: r.x + r.width/2, y: r.y + r.height/2, text: t.substring(0, 80) }};
            }}
        }}
        return null;
    }})('{kw}')""")

    if not option:
        print(f"   WARNING: No autocomplete option for '{keyword}'")
        return

    print(f'   Found: "{option["text"]}"')

    # Trusted coordinate click (deterministic)
    page.mouse.click(option["x"], option["y"])
    page.wait_for_timeout(1000)

    v = page.evaluate(f"""(() => {{
        const inp = document.getElementById('{target_id}');
        if (!inp) return {{ valid: false, value: '' }};
        const cls = inp.className || '';
        return {{ valid: cls.includes('ng-valid') && !cls.includes('ng-invalid'), value: inp.value }};
    }})()""")
    status = "ng-valid" if v["valid"] else "ng-invalid"
    print(f"   {label}: \\"{v['value']}\\" ({status})")
    page.wait_for_timeout(1000)


# -- Step 4: Set departure date (concretized) ---------------------------------
def set_date(page, dep):
    """Navigate ngb-datepicker and click target day."""
    dep_display = dep.strftime("%m/%d/%Y")
    month_name = MONTHS[dep.month - 1]
    day = dep.day
    year = dep.year
    print(f"STEP 3: Date = {dep_display} ({month_name} {day}, {year})...")

    # Click date field by known ID
    df = page.evaluate("""(() => {
        const inp = document.getElementById('am-form-field-control-4');
        if (!inp) return null;
        const r = inp.getBoundingClientRect();
        return r.width > 20 ? { x: r.x + r.width/2, y: r.y + r.height/2 } : null;
    })()""")
    if df:
        page.mouse.click(df["x"], df["y"])
        print("   Clicked date field")
    page.wait_for_timeout(2000)

    # Navigate to target month
    for i in range(12):
        mc = page.evaluate("""(() => {
            const labels = [];
            document.querySelectorAll('.ngb-dp-month-name').forEach(l => {
                if (l.offsetParent !== null) labels.push(l.textContent.trim());
            });
            const ngb = document.querySelector('ngb-datepicker');
            const open = ngb ? (ngb.offsetParent !== null || ngb.getClientRects().length > 0) : false;
            return { labels, open };
        })()""")

        if not mc["open"]:
            print("   Calendar closed - reopening...")
            if df:
                page.mouse.click(df["x"], df["y"])
            page.wait_for_timeout(1500)
            continue

        if any(month_name in l and str(year) in l for l in mc["labels"]):
            print(f"   {month_name} {year} visible")
            break

        page.evaluate("""(() => {
            const b = document.querySelector('button[aria-label="Next month"]');
            if (b) b.click();
        })()""")
        page.wait_for_timeout(800)

    # Remove OneTrust overlay again
    page.evaluate("""(() => {
        const o = document.querySelector('.onetrust-pc-dark-filter');
        if (o) o.remove();
        document.querySelectorAll('[class*="onetrust"]').forEach(el => {
            el.style.pointerEvents = 'none'; el.style.display = 'none';
        });
    })()""")

    # Click target day by aria-label
    day_cell = page.evaluate(f"""((monthName, day, year) => {{
        const els = document.querySelectorAll('[aria-label]');
        for (const el of els) {{
            const aria = el.getAttribute('aria-label') || '';
            if (aria.includes(monthName + ' ' + day + ', ' + year) && el.offsetParent !== null) {{
                const r = el.getBoundingClientRect();
                if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 600)
                    return {{ x: r.x + r.width/2, y: r.y + r.height/2, aria: aria }};
            }}
        }}
        return null;
    }})('{month_name}', '{day}', '{year}')""")

    if day_cell:
        page.mouse.click(day_cell["x"], day_cell["y"])
        page.wait_for_timeout(1000)
        ds = page.evaluate("""(() => {
            const inp = document.getElementById('am-form-field-control-4');
            if (!inp) return { value: '', valid: false };
            const cls = inp.className || '';
            return { value: inp.value, valid: cls.includes('ng-valid') && !cls.includes('ng-invalid') };
        })()""")
        print(f'   Date: value="{ds["value"]}" valid={ds["valid"]}')
        if not ds["valid"]:
            print("   (Angular FormControl ng-invalid - will force-enable button)")
    else:
        print(f"   WARNING: Day {day} not found in calendar")


# -- Step 5: Click Search (concretized) ---------------------------------------
def click_search(page, from_code, to_code, dep_iso):
    """Force-enable FIND TRAINS button and click it."""
    print("STEP 4: Search...")

    fields = page.evaluate("""(() => {
        const fr = document.getElementById('am-form-field-control-0');
        const to = document.getElementById('am-form-field-control-2');
        const dt = document.getElementById('am-form-field-control-4');
        return { fr: fr ? fr.value : 'N/A', to: to ? to.value : 'N/A', date: dt ? dt.value : 'N/A' };
    })()""")
    print(f'   Fields: From="{fields["fr"]}" To="{fields["to"]}" Date="{fields["date"]}"')

    # Force-enable + programmatic click
    clicked = page.evaluate("""(() => {
        const btns = document.querySelectorAll('button');
        for (const b of btns) {
            const text = (b.textContent || '').trim().toLowerCase();
            if (text.includes('find trains') && (b.offsetParent !== null || b.getClientRects().length > 0)) {
                const r = b.getBoundingClientRect();
                if (r.width > 30 && r.height > 15) {
                    const wasDisabled = b.disabled;
                    b.disabled = false;
                    b.removeAttribute('disabled');
                    b.classList.remove('disabled');
                    b.click();
                    return { wasDisabled };
                }
            }
        }
        return null;
    })()""")
    if clicked:
        print(f'   Clicked FIND TRAINS (wasDisabled: {clicked["wasDisabled"]})')

    page.wait_for_timeout(5000)
    url = page.url
    print(f"   URL: {url}")

    # Fallback: direct URL navigation
    if "departure" not in url and "tickets" not in url:
        print("   Still on home - navigating directly...")
        direct_url = (
            f"https://www.amtrak.com/tickets/departure.html"
            f"?journeyOrigin={from_code}&journeyDestination={to_code}"
            f"&departDate={dep_iso}&adults=1&children=0&seniors=0&type=one-way"
        )
        page.goto(direct_url)
        page.wait_for_timeout(8000)
        try:
            page.wait_for_load_state("domcontentloaded")
        except Exception:
            pass

    print("   Waiting for results...")
    page.wait_for_timeout(15000)
    try:
        page.wait_for_load_state("domcontentloaded")
    except Exception:
        pass
    page.wait_for_timeout(3000)
    print(f"   Final URL: {page.url}")


# -- Step 6: Extract trains (concretized) -------------------------------------
def extract_trains(page, from_code, to_code, max_results=5):
    """Extract trains from body text (split by from_code + ' to ' + to_code markers)."""
    print(f"STEP 5: Extract up to {max_results} trains...\\n")

    # Scroll to load dynamic content
    for _ in range(5):
        page.evaluate("window.scrollBy(0, 400)")
        page.wait_for_timeout(500)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(1000)

    body_text = page.evaluate("document.body.innerText")

    import re as _re
    marker = _re.compile(from_code + r"\\s+to\\s+" + to_code)
    blocks = marker.split(body_text)[1:]  # skip header

    def fmt_time(m):
        period = m.group(2)
        return m.group(1) + (period if period.endswith("m") else period + "m")

    trains = []
    for block in blocks:
        if len(trains) >= max_results:
            break
        if "DEPARTS" not in block:
            continue

        tnm = _re.search(
            r"(\\d{1,4})\\s*\\n\\s*(Amtrak\\s+Cascades|Coast\\s+Starlight|Empire\\s+Builder|Southwest\\s+Chief|[A-Z][a-z]+(?:\\s+[A-Za-z]+){0,3})",
            block,
        )
        dep = _re.search(r"DEPARTS\\s+(\\d{1,2}:\\d{2})\\s+([ap]m?)", block, _re.I)
        dur = _re.search(r"(\\d+h\\s*\\d+m)", block, _re.I)
        arr = _re.search(r"ARRIVES\\s+(\\d{1,2}:\\d{2})\\s+([ap]m?)", block, _re.I)
        prc = _re.search(r"Coach\\s+from\\s+\\$\\s*(\\d+)", block, _re.I)

        if dep and arr:
            trains.append({
                "trainNumber": tnm.group(1) if tnm else "",
                "trainName": tnm.group(2).strip() if tnm else "",
                "departure": fmt_time(dep),
                "arrival": fmt_time(arr),
                "duration": dur.group(1) if dur else "N/A",
                "price": f"\${prc.group(1)}" if prc else "N/A",
            })

    return trains


# -- Main ---------------------------------------------------------------------
def run(
    playwright,
    origin: str = "${cfg.from}",
    destination: str = "${cfg.to}",
    max_results: int = ${cfg.maxResults},
) -> list:
    dep = compute_date()
    dep_display = dep.strftime("%m/%d/%Y")
    dep_iso = dep.strftime("%Y-%m-%d")
    from_code = "${cfg.fromCode}"
    to_code = "${cfg.toCode}"

    print("=" * 59)
    print("  Amtrak - Train Ticket Search (One-Way)  v9")
    print("=" * 59)
    print(f"  {origin} -> {destination}")
    print(f"  Departure: {dep_display}  (1 adult, one-way)\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("amtrak_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        print("Loading Amtrak...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print("Loaded\\n")

        dismiss_popups(page)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)

        select_one_way(page)
        enter_station(page, "origin", origin, "${cfg.fromKeyword}")
        enter_station(page, "destination", destination, "${cfg.toKeyword}")
        set_date(page, dep)
        click_search(page, from_code, to_code, dep_iso)
        results = extract_trains(page, from_code, to_code, max_results)

        print(f"\\n" + "=" * 59)
        print(f"  DONE - {len(results)} trains")
        print("=" * 59)
        for i, t in enumerate(results):
            print(
                f"  {i+1}. #{t['trainNumber']} {t['trainName']}  "
                f"Depart: {t['departure']}  Arrive: {t['arrival']}  "
                f"Duration: {t['duration']}  Price: {t['price']}"
            )

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
        print(f"\\nTotal trains found: {len(items)}")
`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────
async function scrollToTop(page) {
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(500);
}

// ── Step 0: Dismiss popups + remove OneTrust overlay ─────────────────────────
async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  await page.waitForTimeout(2000);

  // Click any accept/close/dismiss buttons
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
  await page.waitForTimeout(800);

  // Remove the OneTrust cookie overlay — it covers the full page and intercepts
  // ALL Playwright coordinate clicks (discovered via elementFromPoint diagnostic).
  const removed = await page.evaluate(`(() => {
    let n = 0;
    const df = document.querySelector('.onetrust-pc-dark-filter');
    if (df) { df.remove(); n++; }
    const banner = document.getElementById('onetrust-banner-sdk');
    if (banner) { banner.style.display = 'none'; n++; }
    document.querySelectorAll('[class*="onetrust"], [class*="ot-sdk"], .optanon-alert-box-wrapper')
      .forEach(el => { el.style.pointerEvents = 'none'; el.style.display = 'none'; n++; });
    return n;
  })()`);
  if (removed > 0) console.log(`   ✅ Removed ${removed} OneTrust overlay element(s)`);
}

// ── Step 1: Select One-Way ──────────────────────────────────────────────────
async function selectOneWay(stagehand, page, recorder) {
  console.log("🎯 STEP 0: Select One-Way...");
  await scrollToTop(page);

  // Programmatic click on one-way tab/link
  await page.evaluate(`(() => {
    const tabs = document.querySelectorAll('[role="tab"]');
    for (const t of tabs) {
      if ((t.textContent || '').toLowerCase().includes('one-way')) { t.click(); return; }
    }
    const els = document.querySelectorAll('a, button, label, span, li');
    for (const el of els) {
      const text = (el.textContent || '').trim().toLowerCase();
      if (text === 'one-way' || text === 'one way') {
        const r = el.getBoundingClientRect();
        if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 700) { el.click(); return; }
      }
    }
  })()`);
  await page.waitForTimeout(1500);

  // Verify: Return Date field should be hidden in one-way mode
  const ok = await page.evaluate(`(() => {
    const inputs = document.querySelectorAll('input');
    for (const inp of inputs) {
      if ((inp.placeholder || '').toLowerCase().includes('return')) {
        return !(inp.offsetParent !== null || inp.getClientRects().length > 0);
      }
    }
    return true;
  })()`);
  console.log(`   ${ok ? '✅' : '⚠️'} One-Way mode: ${ok ? 'active' : 'uncertain'}`);
  recorder.record("act", { instruction: "Select One-Way" });
}

// ── Step 2/3: Enter station (concretized) ───────────────────────────────────
async function enterStation(stagehand, page, recorder, which, text, keyword) {
  const isOrigin = which === "origin";
  const label = isOrigin ? "Origin (From)" : "Destination (To)";
  const stepNum = isOrigin ? 1 : 2;
  const targetId = isOrigin ? "am-form-field-control-0" : "am-form-field-control-2";
  console.log(`🎯 STEP ${stepNum}: ${label} = "${text}"...`);
  await scrollToTop(page);
  await page.waitForTimeout(500);

  // 1. Focus and click the field by known ID
  await page.evaluate(`((id) => {
    const inp = document.getElementById(id);
    if (inp) { inp.focus(); inp.click(); inp.select(); }
  })("${targetId}")`);
  await page.waitForTimeout(500);

  // 2. Clear existing text and type the station name
  await page.keyPress("Ctrl+a");
  await page.waitForTimeout(100);
  await page.keyPress("Backspace");
  await page.waitForTimeout(300);
  await page.type(text, { delay: 100 });
  await page.waitForTimeout(CFG.waits.type);

  // Helper: check ng-valid state
  const checkValid = async () =>
    page.evaluate(`(() => {
      const inp = document.getElementById("${targetId}");
      if (!inp) return { valid: false, value: '' };
      const cls = inp.className || '';
      return { valid: cls.includes('ng-valid') && !cls.includes('ng-invalid'), value: inp.value };
    })()`);

  // 3. Find the first matching [role="option"] autocomplete suggestion
  const option = await page.evaluate(`((kw) => {
    const opts = document.querySelectorAll('[role="option"]');
    for (const el of opts) {
      const t = (el.textContent || '').trim();
      if (t.toLowerCase().includes(kw) && el.offsetParent !== null) {
        const r = el.getBoundingClientRect();
        if (r.width > 30 && r.height > 10 && r.y > 0)
          return { x: r.x + r.width/2, y: r.y + r.height/2, text: t.substring(0, 80) };
      }
    }
    return null;
  })("${keyword}")`);

  if (!option) {
    console.log(`   ⚠️ No autocomplete option found for "${keyword}"`);
    recorder.record("act", { instruction: `${label}: ${text}` });
    return;
  }
  console.log(`   📊 Found: "${option.text}"`);

  // ── Primary: Playwright trusted coordinate click (deterministic, zero AI) ──
  await page.click(option.x, option.y);
  await page.waitForTimeout(1000);
  let v = await checkValid();
  console.log(`   📊 Coordinate click: valid=${v.valid} value="${v.value}"`);

  // ── Fallback: observe+act (AI-assisted) if coordinate click failed ──
  if (!v.valid) {
    console.log(`   🔄 Fallback: observe+act...`);
    // Re-type to trigger autocomplete dropdown
    await page.evaluate(`((id) => {
      const inp = document.getElementById(id);
      if (inp) { inp.focus(); inp.select(); }
    })("${targetId}")`);
    await page.keyPress("Ctrl+a");
    await page.waitForTimeout(100);
    await page.keyPress("Backspace");
    await page.waitForTimeout(300);
    await page.type(text, { delay: 80 });
    await page.waitForTimeout(CFG.waits.type);

    const fullName = isOrigin
      ? "Seattle, WA - King Street Station"
      : "Portland, OR - Union Station";
    try {
      const actions = await stagehand.observe(
        `Click on the autocomplete suggestion that says '${fullName}'`
      );
      if (actions.length > 0) {
        await stagehand.act(actions[0]);
        await page.waitForTimeout(1000);
      }
    } catch (e) {
      console.log(`   ⚠️ observe+act error: ${e.message}`);
    }
    v = await checkValid();
    console.log(`   📊 observe+act: valid=${v.valid} value="${v.value}"`);
  }

  console.log(
    `   ${v.valid ? '✅' : '⚠️'} ${label}: "${v.value}" (${v.valid ? 'ng-valid' : 'ng-invalid'})`
  );
  await page.waitForTimeout(1000);
  recorder.record("act", { instruction: `${label}: ${text}` });
}

// ── Step 4: Set departure date (concretized) ────────────────────────────────
async function setDate(stagehand, page, recorder) {
  const { depDisplay, depDay, depMonthName, depYear } = CFG;
  console.log(`🎯 STEP 3: Date = ${depDisplay} (${depMonthName} ${depDay}, ${depYear})...`);
  await scrollToTop(page);
  await page.waitForTimeout(500);

  // Helper: date field coordinates
  const dateFieldXY = async () =>
    page.evaluate(`(() => {
      const inp = document.getElementById("am-form-field-control-4");
      if (!inp) return null;
      const r = inp.getBoundingClientRect();
      return r.width > 20 ? { x: r.x + r.width/2, y: r.y + r.height/2 } : null;
    })()`);

  // 1. Click date field to open the ngb-datepicker calendar
  const df = await dateFieldXY();
  if (df) {
    await page.click(df.x, df.y);
    console.log("   ✅ Clicked date field");
  } else {
    await stagehand.act("Click the departure date field");
  }
  await page.waitForTimeout(2000);

  // 2. Navigate to the target month (calendar shows 2 months at once)
  for (let i = 0; i < 12; i++) {
    const mc = await page.evaluate(`(() => {
      const labels = [];
      document.querySelectorAll('.ngb-dp-month-name').forEach(l => {
        if (l.offsetParent !== null) labels.push(l.textContent.trim());
      });
      const ngb = document.querySelector('ngb-datepicker');
      const open = ngb ? (ngb.offsetParent !== null || ngb.getClientRects().length > 0) : false;
      return { labels, open };
    })()`);

    if (!mc.open) {
      console.log("   ℹ️ Calendar closed — reopening...");
      const d = await dateFieldXY();
      if (d) await page.click(d.x, d.y);
      await page.waitForTimeout(1500);
      continue;
    }

    if (mc.labels.some(l => l.includes(depMonthName) && l.includes(String(depYear)))) {
      console.log(`   ✅ ${depMonthName} ${depYear} visible`);
      break;
    }

    // Programmatic DOM click on Next month button (avoids blur/close)
    await page.evaluate(`(() => {
      const b = document.querySelector('button[aria-label="Next month"]');
      if (b) b.click();
    })()`);
    console.log(`   ➡️ Next month`);
    await page.waitForTimeout(800);
  }

  // 3. Remove OneTrust overlay again (may reappear on dynamic content)
  await page.evaluate(`(() => {
    const o = document.querySelector('.onetrust-pc-dark-filter');
    if (o) o.remove();
    document.querySelectorAll('[class*="onetrust"]').forEach(el => {
      el.style.pointerEvents = 'none'; el.style.display = 'none';
    });
  })()`);

  // 4. Find target day cell by aria-label (e.g. "Monday, April 27, 2026")
  const dayCell = await page.evaluate(`((monthName, day, year) => {
    const els = document.querySelectorAll('[aria-label]');
    for (const el of els) {
      const aria = el.getAttribute('aria-label') || '';
      if (aria.includes(monthName + ' ' + day + ', ' + year) && el.offsetParent !== null) {
        const r = el.getBoundingClientRect();
        if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 600)
          return { x: r.x + r.width/2, y: r.y + r.height/2, aria };
      }
    }
    return null;
  })("${depMonthName}", "${depDay}", "${depYear}")`);

  if (dayCell) {
    // Trusted Playwright coordinate click on the day cell
    await page.click(dayCell.x, dayCell.y);
    await page.waitForTimeout(1000);
    const ds = await page.evaluate(`(() => {
      const inp = document.getElementById("am-form-field-control-4");
      if (!inp) return { value: '', valid: false };
      const cls = inp.className || '';
      return { value: inp.value, valid: cls.includes('ng-valid') && !cls.includes('ng-invalid') };
    })()`);
    console.log(`   📊 Date: value="${ds.value}" valid=${ds.valid}`);
    if (!ds.valid) {
      console.log("   ℹ️ Angular FormControl ng-invalid (expected — will force-enable button)");
    }
  } else {
    console.log(`   ⚠️ Day ${depDay} not found in calendar`);
  }

  recorder.record("act", { instruction: `Set date to ${depDisplay}` });
}

// ── Step 5: Click Search (concretized) ──────────────────────────────────────
async function clickSearch(stagehand, page, recorder) {
  console.log("🎯 STEP 4: Search...");
  await scrollToTop(page);
  await page.waitForTimeout(500);

  // Log field values for verification
  const fields = await page.evaluate(`(() => {
    const from = document.getElementById("am-form-field-control-0");
    const to = document.getElementById("am-form-field-control-2");
    const date = document.getElementById("am-form-field-control-4");
    return {
      from: from ? from.value : 'N/A',
      to: to ? to.value : 'N/A',
      date: date ? date.value : 'N/A',
    };
  })()`);
  console.log(`   📊 Fields: From="${fields.from}" To="${fields.to}" Date="${fields.date}"`);

  // Force-enable the FIND TRAINS button (may be disabled due to Angular ng-invalid
  // on date), then programmatic click. This was the approach that successfully
  // navigated to the results page in v8 testing.
  const clicked = await page.evaluate(`(() => {
    const btns = document.querySelectorAll('button');
    for (const b of btns) {
      const text = (b.textContent || '').trim().toLowerCase();
      if (text.includes('find trains') && (b.offsetParent !== null || b.getClientRects().length > 0)) {
        const r = b.getBoundingClientRect();
        if (r.width > 30 && r.height > 15) {
          const wasDisabled = b.disabled;
          b.disabled = false;
          b.removeAttribute('disabled');
          b.classList.remove('disabled');
          b.click();
          return { wasDisabled };
        }
      }
    }
    return null;
  })()`);
  if (clicked) console.log(`   ✅ Clicked FIND TRAINS (wasDisabled: ${clicked.wasDisabled})`);
  else console.log("   ⚠️ FIND TRAINS button not found");

  // Wait for navigation to results page
  await page.waitForTimeout(5000);
  let url = page.url();
  console.log(`   📍 URL: ${url}`);

  // Fallback: direct URL navigation if still on home page
  if (!url.includes("departure") && !url.includes("tickets")) {
    console.log("   ℹ️ Still on home — navigating directly to search URL...");
    const directUrl =
      `https://www.amtrak.com/tickets/departure.html` +
      `?journeyOrigin=${CFG.fromCode}&journeyDestination=${CFG.toCode}` +
      `&departDate=${CFG.depISO}&adults=1&children=0&seniors=0&type=one-way`;
    await page.goto(directUrl);
    await page.waitForTimeout(8000);
    try { await page.waitForLoadState("domcontentloaded"); } catch (e) {}
  }

  // Final wait for content to render
  console.log("   ⏳ Waiting for results...");
  await page.waitForTimeout(CFG.waits.search);
  try { await page.waitForLoadState("domcontentloaded"); } catch (e) {}
  await page.waitForTimeout(3000);
  console.log(`   📍 Final URL: ${page.url()}`);
  recorder.record("act", { instruction: "Click FIND TRAINS" });
}

// ── Step 6: Extract trains (concretized) ────────────────────────────────────
async function extractTrains(stagehand, page, recorder) {
  console.log(`🎯 STEP 5: Extract up to ${CFG.maxResults} trains...\n`);

  // Scroll to load all dynamic content
  for (let i = 0; i < 5; i++) {
    await page.evaluate("window.scrollBy(0, 400)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // Get body text from the browser, then parse in Node.js (avoids
  // double-escaping issues inside page.evaluate template literals).
  const bodyText = await page.evaluate("document.body.innerText");

  // Amtrak results page has each train block separated by "SEA to PDX" markers.
  // Times appear as "7:10\na" (time on one line, period letter on next line).
  // Prices appear as "Coach\nfrom\n$\n27".
  const marker = new RegExp(`${CFG.fromCode}\\s+to\\s+${CFG.toCode}`);
  const blocks = bodyText.split(marker).slice(1);

  const fmtTime = (m) => m[1] + (m[2].endsWith("m") ? m[2] : m[2] + "m");
  const trains = [];

  for (const block of blocks) {
    if (trains.length >= CFG.maxResults) break;
    if (!block.includes("DEPARTS")) continue;

    // Train number + name (e.g. "503\nAmtrak Cascades" or "11\nCoast Starlight")
    const tnm = block.match(
      /(\d{1,4})\s*\n\s*(Amtrak\s+Cascades|Coast\s+Starlight|Empire\s+Builder|Southwest\s+Chief|[A-Z][a-z]+(?:\s+[A-Za-z]+){0,3})/
    );

    // Depart time: "DEPARTS\n7:10\na" — \s+ matches newlines
    const dep = block.match(/DEPARTS\s+(\d{1,2}:\d{2})\s+([ap]m?)/i);

    // Duration: "3h 25m" or "4h 0m"
    const dur = block.match(/(\d+h\s*\d+m)/i);

    // Arrive time: "ARRIVES\n10:35\na"
    const arr = block.match(/ARRIVES\s+(\d{1,2}:\d{2})\s+([ap]m?)/i);

    // Lowest coach price: "Coach\nfrom\n$\n27"
    const prc = block.match(/Coach\s+from\s+\$\s*(\d+)/i);

    if (dep && arr) {
      trains.push({
        trainNumber: tnm ? tnm[1] : "",
        trainName: tnm ? tnm[2].trim() : "",
        departure: fmtTime(dep),
        arrival: fmtTime(arr),
        duration: dur ? dur[1] : "N/A",
        price: prc ? "$" + prc[1] : "N/A",
      });
    }
  }

  let result;
  if (trains.length > 0) {
    result = { trains };
  } else {
    // AI fallback only if text parsing found nothing
    console.log("   ⚠️ Text parsing found 0 trains — using AI extraction...");
    const { z } = require("zod/v3");
    result = await stagehand.extract(
      `Extract up to ${CFG.maxResults} train options. For each: train number, name, departure time, arrival time, duration, lowest coach price.`,
      z.object({
        trains: z.array(
          z.object({
            trainNumber: z.string(),
            trainName: z.string(),
            departure: z.string(),
            arrival: z.string(),
            duration: z.string(),
            price: z.string(),
          })
        ),
      })
    );
  }

  recorder.record("extract", { instruction: "Extract trains", results: result });
  console.log(`📋 Found ${result.trains.length} trains:`);
  result.trains.forEach((t, i) => {
    console.log(
      `   ${i + 1}. #${t.trainNumber} ${t.trainName}  Depart: ${t.departure}  Arrive: ${t.arrival}  Duration: ${t.duration}  💰 ${t.price}`
    );
  });
  return result;
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Amtrak – Train Ticket Search (One-Way)  v9");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🚆 ${CFG.from} → ${CFG.to}`);
  console.log(`  📅 Departure: ${CFG.depDisplay}  (1 adult, one-way)\n`);

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");
  let stagehand;

  try {
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(
          os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
        ),
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-extensions",
          "--start-maximized",
          "--window-size=1920,1080",
        ],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");
    const page = stagehand.context.pages()[0];

    // Navigate
    console.log("🌐 Loading Amtrak...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    recorder.wait(CFG.waits.page, "Initial load");
    await page.waitForTimeout(CFG.waits.page);
    console.log("✅ Loaded\n");

    // Execute all steps
    await dismissPopups(page);
    await selectOneWay(stagehand, page, recorder);
    await enterStation(stagehand, page, recorder, "origin", CFG.from, CFG.fromKeyword);
    await enterStation(stagehand, page, recorder, "destination", CFG.to, CFG.toKeyword);
    await setDate(stagehand, page, recorder);
    await clickSearch(stagehand, page, recorder);
    const trains = await extractTrains(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${trains.trains.length} trains`);
    console.log("═══════════════════════════════════════════════════════════");
    trains.trains.forEach((t, i) => {
      console.log(
        `  ${i + 1}. #${t.trainNumber} ${t.trainName}  Depart: ${t.departure}  Arrive: ${t.arrival}  Duration: ${t.duration}  💰 ${t.price}`
      );
    });

    // Save outputs
    fs.writeFileSync(path.join(__dirname, "amtrak_search.py"), genPython(CFG), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(
      path.join(__dirname, "recorded_actions.json"),
      JSON.stringify(recorder.actions, null, 2),
      "utf-8"
    );
    console.log("📋 Actions saved");

    return trains;
  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      fs.writeFileSync(path.join(__dirname, "amtrak_search.py"), genPython(CFG), "utf-8");
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
