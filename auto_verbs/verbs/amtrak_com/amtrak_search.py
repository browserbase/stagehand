"""
Amtrak - Train Ticket Search (One-Way)  v9 - Concretized
Seattle, WA -> Portland, OR
Departure: 2 months from today  (1 adult, one-way)

Generated on: 2026-02-27T21:21:21.214Z
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
import os
import traceback
from datetime import date
from dateutil.relativedelta import relativedelta
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil

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
    print(f"STEP {step}: {label} = \"{station_name}\"...")

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
    print(f"   {label}: \"{v['value']}\" ({status})")
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

    # Click target day by aria-label — use JS click (coordinate clicks unreliable
    # due to overlays / viewport offset), then fall back to mouse click if needed.
    day_click = page.evaluate(f"""((monthName, day, year) => {{
        const target = monthName + ' ' + day + ', ' + year;
        const els = document.querySelectorAll('[aria-label]');
        for (const el of els) {{
            const aria = el.getAttribute('aria-label') || '';
            if (aria.includes(target) && el.offsetParent !== null) {{
                const r = el.getBoundingClientRect();
                if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < 800) {{
                    // Try clicking the inner <span> or the element itself
                    const inner = el.querySelector('span, div') || el;
                    inner.click();
                    return {{ clicked: true, aria: aria, method: 'inner-click' }};
                }}
            }}
        }}
        // Also try div[aria-label] pattern used by some ngb-datepicker versions
        const divs = document.querySelectorAll('div.ngb-dp-day, [class*="dp-day"]');
        for (const d of divs) {{
            const aria = d.getAttribute('aria-label') || '';
            if (aria.includes(target)) {{
                d.click();
                return {{ clicked: true, aria: aria, method: 'div-click' }};
            }}
        }}
        return {{ clicked: false, aria: null, method: null }};
    }})('{month_name}', '{day}', '{year}')""")

    if day_click["clicked"]:
        print(f'   Clicked day: "{day_click["aria"]}" via {day_click["method"]}')
        page.wait_for_timeout(1000)

        # Verify the date was set
        ds = page.evaluate("""(() => {
            const inp = document.getElementById('am-form-field-control-4');
            if (!inp) return { value: '', valid: false };
            const cls = inp.className || '';
            return { value: inp.value, valid: cls.includes('ng-valid') && !cls.includes('ng-invalid') };
        })()""")
        print(f'   Date: value="{ds["value"]}" valid={ds["valid"]}')

        # If JS click didn't register, force-set value directly
        if not ds["valid"] or not ds["value"]:
            print("   JS click didn't set value — forcing date value via Angular ngModel...")
            page.evaluate(f"""(() => {{
                const inp = document.getElementById('am-form-field-control-4');
                if (!inp) return;
                // Set value and trigger Angular change detection
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                    window.HTMLInputElement.prototype, 'value').set;
                nativeInputValueSetter.call(inp, '{dep_display}');
                inp.dispatchEvent(new Event('input', {{ bubbles: true }}));
                inp.dispatchEvent(new Event('change', {{ bubbles: true }}));
                inp.dispatchEvent(new Event('blur', {{ bubbles: true }}));
            }})()""")
            page.wait_for_timeout(500)
            ds2 = page.evaluate("""(() => {
                const inp = document.getElementById('am-form-field-control-4');
                if (!inp) return { value: '', valid: false };
                const cls = inp.className || '';
                return { value: inp.value, valid: cls.includes('ng-valid') && !cls.includes('ng-invalid') };
            })()""")
            print(f'   After force-set: value="{ds2["value"]}" valid={ds2["valid"]}')
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

    page.wait_for_timeout(2000)
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
        page.wait_for_timeout(4000)
        try:
            page.wait_for_load_state("domcontentloaded")
        except Exception:
            pass

    print("   Waiting for results...")
    page.wait_for_timeout(3000)
    try:
        page.wait_for_load_state("domcontentloaded")
    except Exception:
        pass
    page.wait_for_timeout(3000)
    print(f"   Final URL: {page.url}")


# -- Step 6: Extract trains (concretized) -------------------------------------
def extract_trains(page, from_code, to_code, max_results=5):
    """Extract trains from body text (split by from_code + ' to ' + to_code markers)."""
    print(f"STEP 5: Extract up to {max_results} trains...\n")

    # Scroll to load dynamic content
    for _ in range(5):
        page.evaluate("window.scrollBy(0, 400)")
        page.wait_for_timeout(500)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(1000)

    body_text = page.evaluate("document.body.innerText")

    import re as _re
    marker = _re.compile(from_code + r"\s+to\s+" + to_code)
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
            r"(\d{1,4})\s*\n\s*(Amtrak\s+Cascades|Coast\s+Starlight|Empire\s+Builder|Southwest\s+Chief|[A-Z][a-z]+(?:\s+[A-Za-z]+){0,3})",
            block,
        )
        dep = _re.search(r"DEPARTS\s+(\d{1,2}:\d{2})\s+([ap]m?)", block, _re.I)
        dur = _re.search(r"(\d+h\s*\d+m)", block, _re.I)
        arr = _re.search(r"ARRIVES\s+(\d{1,2}:\d{2})\s+([ap]m?)", block, _re.I)
        prc = _re.search(r"Coach\s+from\s+\$\s*(\d+)", block, _re.I)

        if dep and arr:
            trains.append({
                "trainNumber": tnm.group(1) if tnm else "",
                "trainName": tnm.group(2).strip() if tnm else "",
                "departure": fmt_time(dep),
                "arrival": fmt_time(arr),
                "duration": dur.group(1) if dur else "N/A",
                "price": f"${prc.group(1)}" if prc else "N/A",
            })

    return trains


# -- Main ---------------------------------------------------------------------
def run(
    playwright,
    origin: str = "Seattle, WA",
    destination: str = "Portland, OR",
    max_results: int = 5,
) -> list:
    dep = compute_date()
    dep_display = dep.strftime("%m/%d/%Y")
    dep_iso = dep.strftime("%Y-%m-%d")
    from_code = "SEA"
    to_code = "PDX"

    print("=" * 59)
    print("  Amtrak - Train Ticket Search (One-Way)  v9")
    print("=" * 59)
    print(f"  {origin} -> {destination}")
    print(f"  Departure: {dep_display}  (1 adult, one-way)\n")

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
        page.goto("https://www.amtrak.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(1000)
        print("Loaded\n")

        dismiss_popups(page)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)

        select_one_way(page)
        enter_station(page, "origin", origin, "seattle")
        enter_station(page, "destination", destination, "portland")
        set_date(page, dep)
        click_search(page, from_code, to_code, dep_iso)
        results = extract_trains(page, from_code, to_code, max_results)

        print(f"\n" + "=" * 59)
        print(f"  DONE - {len(results)} trains")
        print("=" * 59)
        for i, t in enumerate(results):
            print(
                f"  {i+1}. #{t['trainNumber']} {t['trainName']}  "
                f"Depart: {t['departure']}  Arrive: {t['arrival']}  "
                f"Duration: {t['duration']}  Price: {t['price']}"
            )

    except Exception as e:
        print(f"\nError: {e}")
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
        print(f"\nTotal trains found: {len(items)}")
