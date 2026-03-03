"""
Hertz – Car Rental at LAX
Pure Playwright CDP – no AI.

Starts from the reservation search page, fills in location (LAX) and dates,
submits the form, then extracts vehicle results from the MUI DOM.
Uses a clean temp profile to avoid corporate-discount injection.
"""
import json, re, os, traceback, sys, shutil, subprocess, tempfile, time
from datetime import date, timedelta
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import find_chrome_executable, get_free_port


# ── extraction ───────────────────────────────────────────

def extract_cars(page, max_results: int = 5) -> list[dict]:
    """Pull car data straight from the MUI DOM.

    Each vehicle lives in a MuiCard-root inside a MuiGrid-item.  The card's
    innerText follows this pattern (verified via DOM inspection):

        Midsize SUV 2WD          ← car class
        Nissan Rogue or similar  ← model
        5  4                     ← passengers / luggage
        Auto   2WD   25 MPG     ← specs
        Pay now and save
        $76                      ← daily price
        /day
        $531                     ← est. total
        est. total
    """
    return page.evaluate(r"""(maxResults) => {
        /* Find the grid container inside <main> that holds 10+ items */
        const grids = document.querySelectorAll(
            '.MuiGrid-container .MuiGrid-item .MuiCard-root'
        );
        const results = [];
        const seen = new Set();

        for (const card of grids) {
            if (results.length >= maxResults) break;
            const raw = card.innerText;
            if (!raw || raw.length < 20) continue;

            const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length < 3) continue;

            /* ── car class (first line) ── */
            const carClass = lines[0];

            /* ── model: look for "or similar" ── */
            let model = '';
            for (const ln of lines) {
                if (/or similar/i.test(ln)) { model = ln; break; }
            }

            const displayName = model
                ? carClass + ' – ' + model
                : carClass;

            /* dedup */
            const key = displayName.toLowerCase().replace(/\s+/g, ' ');
            if (seen.has(key)) continue;
            seen.add(key);

            /* ── daily price: first "$XX" followed by "/day" ── */
            let dailyPrice = 'N/A';
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^\$(\d[\d,]*)/);
                if (m && i + 1 < lines.length && lines[i + 1].includes('/day')) {
                    dailyPrice = '$' + m[1] + '/day';
                    break;
                }
            }

            /* ── total price: "$XXX" followed by "est. total" ── */
            let totalPrice = 'N/A';
            for (let i = 0; i < lines.length; i++) {
                const m = lines[i].match(/^\$(\d[\d,]*)/);
                if (m && lines.slice(i, i + 3).some(l => /est\.\s*total/i.test(l))) {
                    totalPrice = '$' + m[1];
                    break;
                }
            }

            results.push({
                car_name: displayName,
                daily_price: dailyPrice,
                total_price: totalPrice,
            });
        }
        return results;
    }""", max_results)


# ── calendar / form helpers ──────────────────────────────

def dismiss_popups(page):
    for sel in ["#onetrust-accept-btn-handler", "button:has-text('Accept')",
                "button:has-text('Close')", "button:has-text('Got it')"]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=600):
                loc.evaluate("el => el.click()")
                time.sleep(0.3)
        except Exception:
            pass


def is_calendar_open(page):
    return page.evaluate(
        "(() => { const dp = document.querySelector('.DayPicker');"
        " return dp ? dp.offsetParent !== null : false; })()"
    )


def ensure_calendar_open(page, trigger_id, max_attempts=3):
    for _ in range(max_attempts):
        if is_calendar_open(page):
            return True
        page.locator(trigger_id).evaluate("el => el.click()")
        page.wait_for_timeout(2000)
    return is_calendar_open(page)


def find_day_cell(page, pattern, padded):
    cell = page.locator(f"div.DayPicker-Day[aria-label*='{pattern}']")
    if cell.count() > 0:
        return cell.first
    cell = page.locator(f"div.DayPicker-Day[aria-label*='{padded}']")
    if cell.count() > 0:
        return cell.first
    return None


def click_next_month(page):
    btn = page.locator("[aria-label='Next Month']")
    if btn.count() > 0:
        btn.first.evaluate("el => el.click()")
        page.wait_for_timeout(600)
        return True
    return False


def navigate_to_day(page, aria, aria_pad, max_months=12):
    """Navigate the calendar forward until we find the target day cell and click it."""
    for _ in range(max_months):
        cell = find_day_cell(page, aria, aria_pad)
        if cell:
            cell.evaluate("el => el.click()")
            page.wait_for_timeout(800)
            return True
        if not click_next_month(page):
            break
    return False


# ── main ─────────────────────────────────────────────────

def main():
    pickup  = date.today() + timedelta(days=60)
    dropoff = pickup + timedelta(days=5)
    pu_iso  = pickup.strftime("%Y-%m-%d")
    do_iso  = dropoff.strftime("%Y-%m-%d")

    # Aria labels for DayPicker cells (e.g. "May 1 2026")
    pu_aria     = f"{pickup.strftime('%b')} {pickup.day} {pickup.year}"
    pu_aria_pad = f"{pickup.strftime('%b')} {pickup.day:02d} {pickup.year}"
    do_aria     = f"{dropoff.strftime('%b')} {dropoff.day} {dropoff.year}"
    do_aria_pad = f"{dropoff.strftime('%b')} {dropoff.day:02d} {dropoff.year}"

    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="hertz_chrome_")
    chrome = os.environ.get("CHROME_PATH") or find_chrome_executable()

    chrome_proc = subprocess.Popen(
        [
            chrome,
            f"--remote-debugging-port={port}",
            f"--user-data-dir={profile_dir}",
            "--remote-allow-origins=*",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-blink-features=AutomationControlled",
            "--window-size=1280,987",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    try:
        # Wait for CDP
        ws_url = None
        deadline = time.time() + 15
        while time.time() < deadline:
            try:
                resp = urlopen(f"http://127.0.0.1:{port}/json/version", timeout=2)
                ws_url = json.loads(resp.read()).get("webSocketDebuggerUrl", "")
                if ws_url:
                    break
            except Exception:
                pass
            time.sleep(0.4)
        if not ws_url:
            raise TimeoutError("Chrome CDP not ready")

        with sync_playwright() as pw:
            browser = pw.chromium.connect_over_cdp(ws_url)
            context = browser.contexts[0]
            page = context.pages[0] if context.pages else context.new_page()

            # ── STEP 1: Load reservation search page ──
            print(f"STEP 1: Navigate to Hertz reservation page…")
            page.goto("https://www.hertz.com/rentacar/reservation/",
                      wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(5000)
            dismiss_popups(page)
            page.wait_for_timeout(500)

            # ── STEP 2: Fill pickup location ──
            print("STEP 2: Setting pickup location to LAX…")
            page.locator("#locationInput").evaluate("el => el.click()")
            page.locator("#locationInput").fill("LAX")
            page.wait_for_timeout(2500)
            if page.locator("li[role='option']").count() > 0:
                page.locator("li[role='option']").first.evaluate("el => el.click()")
            page.wait_for_timeout(1500)

            # ── STEP 3: Set pickup date ──
            print(f"STEP 3: Setting pickup date ({pu_aria})…")
            ensure_calendar_open(page, "#dateTimePickerTriggerFrom")
            pu_found = navigate_to_day(page, pu_aria, pu_aria_pad)
            print(f"  Pickup date {'set' if pu_found else 'NOT found'}")
            page.wait_for_timeout(1000)

            # ── STEP 4: Set return date ──
            print(f"STEP 4: Setting return date ({do_aria})…")
            do_found = False
            # Calendar may still be open after picking pickup date
            page.wait_for_timeout(800)
            cell = find_day_cell(page, do_aria, do_aria_pad)
            if cell:
                cell.evaluate("el => el.click()")
                page.wait_for_timeout(800)
                do_found = True
            if not do_found and is_calendar_open(page):
                do_found = navigate_to_day(page, do_aria, do_aria_pad, max_months=6)
            if not do_found:
                ensure_calendar_open(page, "#dateTimePickerTriggerTo")
                do_found = navigate_to_day(page, do_aria, do_aria_pad, max_months=6)
            print(f"  Return date {'set' if do_found else 'NOT found'}")
            page.wait_for_timeout(500)

            # Close calendar
            page.evaluate(
                "(() => { document.dispatchEvent(new KeyboardEvent('keydown',"
                " {key:'Escape',code:'Escape',bubbles:true}));"
                " document.activeElement?.blur(); })()"
            )
            page.wait_for_timeout(1000)
            if is_calendar_open(page):
                try:
                    page.locator("header").first.evaluate("el => el.click()")
                except Exception:
                    pass
                page.wait_for_timeout(1000)

            # ── STEP 5: Submit search ──
            print("STEP 5: Submitting search…")
            page.evaluate(
                "(() => { const b = document.querySelector(\"button[type='submit']\");"
                " if (b) b.click(); })()"
            )
            page.wait_for_timeout(12000)
            print(f"  URL: {page.url[:120]}")

            # Fallback: if still on search page, navigate directly
            if "/book/vehicles" not in page.url and "/reservation/vehicle" not in page.url:
                vehicle_url = (
                    f"https://www.hertz.com/us/en/book/vehicles?"
                    f"pid=LAXT15&did=LAXT15"
                    f"&pdate={pu_iso}T12%3A00%3A00&ddate={do_iso}T12%3A00%3A00"
                    f"&age=25"
                )
                print(f"  Form submit didn't navigate — going directly…")
                page.goto(vehicle_url, wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(12000)
                print(f"  URL: {page.url[:120]}")

            # Check for error page
            snippet = page.evaluate("document.body.innerText.substring(0, 500)")
            if any(kw in snippet.lower() for kw in ["bad request", "something went wrong", "oops"]):
                print("  ⚠ Error page — reloading…")
                page.reload(wait_until="domcontentloaded", timeout=30000)
                page.wait_for_timeout(10000)

            # Scroll to trigger lazy-loaded cards
            for _ in range(5):
                page.evaluate("window.scrollBy(0, 600)")
                page.wait_for_timeout(600)

            # ── STEP 6: Extract car listings ──
            print("STEP 6: Extracting car listings…")
            cars = extract_cars(page, 5)

            # Fallback: body text scan
            if not cars:
                print("  DOM extraction returned 0 — falling back to body text…")
                body = page.evaluate("document.body.innerText")
                lines = [l.strip() for l in body.split("\n") if l.strip()]
                for i, line in enumerate(lines):
                    if "or similar" in line.lower() and 5 < len(line) < 80:
                        car_class = lines[i - 1] if i > 0 and len(lines[i - 1]) < 60 else ""
                        display = (car_class + " – " + line) if car_class else line
                        price = "N/A"
                        for j in range(i + 1, min(i + 8, len(lines))):
                            m = re.search(r"\$(\d[\d,]*)", lines[j])
                            if m:
                                price = "$" + m.group(1) + "/day"
                                break
                        cars.append({"car_name": display, "daily_price": price,
                                     "total_price": "N/A"})
                    if len(cars) >= 5:
                        break

            browser.close()

        # ── display ──
        print()
        print("=" * 60)
        print(f"  Hertz – LAX Car Rentals  ({pu_iso} → {do_iso})")
        print("=" * 60)
        for idx, c in enumerate(cars, 1):
            print(f"  {idx}. {c['car_name']}")
            print(f"     Daily: {c['daily_price']}   Total: {c.get('total_price', 'N/A')}")
            print()

        if not cars:
            print("  ⚠ No cars extracted.")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
