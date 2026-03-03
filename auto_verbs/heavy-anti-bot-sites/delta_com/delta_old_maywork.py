
"""
Auto-generated Playwright script (Python)
Delta Air Lines – Round Trip Flight Search
From: Seattle → To: Chicago

Concretized from successful JS runs — uses Playwright locator clicks
(trusted events) for all Angular interactions on delta.com.
"""

import re
import os
from datetime import date, timedelta
from dateutil.relativedelta import relativedelta
from playwright.sync_api import Playwright, sync_playwright


MONTH_NAMES = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


def compute_dates():
    today = date.today()
    departure = today + relativedelta(months=2)
    ret = departure + timedelta(days=4)
    return departure.strftime("%m/%d/%Y"), ret.strftime("%m/%d/%Y")


def run(
    playwright: Playwright,
    origin: str = "Seattle",
    destination: str = "Chicago",
    departure_date: str = None,
    return_date: str = None,
    max_results: int = 5,
) -> list:
    if departure_date is None or return_date is None:
        departure_date, return_date = compute_dates()

    print(f"  {origin} -> {destination}")
    print(f"  Dep: {departure_date}  Ret: {return_date}\n")

    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )

    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport={"width": 1920, "height": 1080},
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
            "--start-maximized",
            "--window-size=1920,1080",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    # ── Parse dates ───────────────────────────────────────────────────
    dep_parts = departure_date.split("/")
    dep_m, dep_d, dep_y = int(dep_parts[0]), int(dep_parts[1]), int(dep_parts[2])
    ret_parts = return_date.split("/")
    ret_m, ret_d, ret_y = int(ret_parts[0]), int(ret_parts[1]), int(ret_parts[2])
    dep_month_name = MONTH_NAMES[dep_m - 1]
    ret_month_name = MONTH_NAMES[ret_m - 1]

    # ── Helper: read calendar month via DOM text scan ─────────────────
    def read_calendar_month():
        return page.evaluate(r'''() => {
            const months = ['January','February','March','April','May','June',
                            'July','August','September','October','November','December'];
            const re = new RegExp('\\b(' + months.join('|') + ')\\s+(\\d{4})\\b', 'i');
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null);
            while (walker.nextNode()) {
                const text = walker.currentNode.textContent.trim();
                if (text.length < 4 || text.length > 30) continue;
                const match = text.match(re);
                if (match) {
                    const el = walker.currentNode.parentElement;
                    if (el) {
                        const r = el.getBoundingClientRect();
                        if (r.height > 0 && r.width > 0 && r.y > 0 && r.y < window.innerHeight)
                            return match[0];
                    }
                }
            }
            const ariaEls = document.querySelectorAll('[aria-label]');
            for (const el of ariaEls) {
                const label = el.getAttribute('aria-label') || '';
                const match = label.match(re);
                if (match) {
                    const r = el.getBoundingClientRect();
                    if (r.height > 0 && r.width > 0 && r.y > 0) return match[0];
                }
            }
            return '';
        }''')

    # ── Helper: click next-month arrow ────────────────────────────────
    def click_next_month():
        arrow = page.evaluate(r'''() => {
            const btns = document.querySelectorAll('button, a, [role="button"], span[class*="icon"]');
            for (const btn of btns) {
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                const title = (btn.getAttribute('title') || '').toLowerCase();
                const text = (btn.textContent || '').trim();
                const cls = (btn.className || '').toLowerCase();
                if (aria.includes('next') || aria.includes('forward') ||
                    title.includes('next') || title.includes('forward') ||
                    cls.includes('next') || cls.includes('forward') || cls.includes('right-arrow') ||
                    text === '\u203a' || text === '>' || text === '\u2192' || text === '\u00bb') {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 5 && r.height > 5 && r.y > 0 && r.y < window.innerHeight)
                        return {'x': r.x + r.width/2, 'y': r.y + r.height/2};
                }
            }
            return null;
        }''')
        if arrow:
            page.mouse.click(arrow['x'], arrow['y'])
            return True
        return False

    # ── Helper: click a specific day in the calendar ──────────────────
    def click_day(day_num, month_name, year):
        day_cell = page.evaluate(f'''((d, m, y) => {{
            const patterns = [d + ' ' + m + ' ' + y, m + ' ' + d + ', ' + y, m + ' ' + d + ' ' + y];
            const allEls = document.querySelectorAll('[aria-label], td, button, a, [role="gridcell"]');
            for (const el of allEls) {{
                const aria = (el.getAttribute('aria-label') || '');
                const lower = aria.toLowerCase();
                for (const pat of patterns) {{
                    if (lower.includes(pat.toLowerCase())) {{
                        const r = el.getBoundingClientRect();
                        if (r.width > 10 && r.height > 10 && r.y > 0 && r.y < window.innerHeight)
                            return {{'x': r.x + r.width/2, 'y': r.y + r.height/2, 'method': 'aria-label', 'label': aria.substring(0, 60)}};
                    }}
                }}
            }}
            const cells = document.querySelectorAll('td, button, a, [role="gridcell"], span, div');
            const candidates = [];
            for (const cell of cells) {{
                let directText = '';
                for (const node of cell.childNodes) {{
                    if (node.nodeType === 3) directText += node.textContent;
                }}
                directText = directText.trim();
                const fullText = (cell.textContent || '').trim();
                if (directText !== String(d) && fullText !== String(d)) continue;
                const r = cell.getBoundingClientRect();
                if (r.width >= 15 && r.height >= 15 && r.width <= 100 && r.height <= 100 && r.y > 100 && r.y < window.innerHeight)
                    candidates.push({{'x': r.x + r.width/2, 'y': r.y + r.height/2, 'area': r.width * r.height}});
            }}
            candidates.sort((a, b) => b.area - a.area);
            return candidates[0] || null;
        }})({day_num}, "{month_name}", {year})''')
        if day_cell:
            page.mouse.click(day_cell['x'], day_cell['y'])
            return True
        return False

    # ── Helper: find element coords for trusted Playwright click ──────
    def find_and_click(js_expr):
        """Evaluate JS that returns {x, y} or null, then mouse.click."""
        coords = page.evaluate(js_expr)
        if coords:
            page.mouse.click(coords['x'], coords['y'])
            return True
        return False

    try:
        # ── Navigate ──────────────────────────────────────────────────
        print("Loading Delta Air Lines...")
        page.goto("https://www.delta.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups ────────────────────────────────────────────
        for selector in [
            "button:has-text('No Thanks')",
            "button:has-text('No, thanks')",
            "button:has-text('Close')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "[aria-label='Close']",
            "[data-dismiss='modal']",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.click()
                    page.wait_for_timeout(500)
            except Exception:
                pass
        page.wait_for_timeout(1000)

        # ── STEP 0: Click BOOK tab ───────────────────────────────────
        print("STEP 0: Ensure Book tab...")
        find_and_click(r'''(() => {
            const candidates = document.querySelectorAll('a, button, span, li, [role="tab"]');
            for (const el of candidates) {
                const text = (el.textContent || '').trim();
                if (text.toLowerCase() === 'book' || text.toLowerCase() === 'book a trip') {
                    const r = el.getBoundingClientRect();
                    if (r.y < 400 && r.width > 20 && (el.offsetParent !== null || el.getClientRects().length > 0))
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        print("  Clicked BOOK tab")
        page.wait_for_timeout(2000)
        # Also click Flights sub-tab
        find_and_click(r'''(() => {
            const candidates = document.querySelectorAll('a, button, span, li, label, [role="tab"]');
            for (const el of candidates) {
                const text = (el.textContent || '').trim().toLowerCase();
                if (text === 'flights' || text === 'flight') {
                    const r = el.getBoundingClientRect();
                    if (r.y < 400 && (el.offsetParent !== null || el.getClientRects().length > 0))
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        page.wait_for_timeout(1000)

        # ── STEP 1: Ensure Round Trip ─────────────────────────────────
        print("STEP 1: Ensuring Round Trip...")
        trip_type = page.evaluate(r'''() => {
            const els = document.querySelectorAll('button, a, span, label, [role="tab"], select, li');
            for (const el of els) {
                const t = (el.textContent || '').trim().toLowerCase();
                const r = el.getBoundingClientRect();
                if (r.y < 350 && (t === 'round trip' || t === 'roundtrip'))
                    return t;
            }
            return '';
        }''')
        if 'round trip' in (trip_type or ''):
            print("  Already Round Trip")
        else:
            print("  Selecting Round Trip...")
            # Click round trip option if available
            find_and_click(r'''(() => {
                const els = document.querySelectorAll('li, button, a, label, [role="option"]');
                for (const el of els) {
                    const t = (el.textContent || '').trim().toLowerCase();
                    if (t === 'round trip') {
                        const r = el.getBoundingClientRect();
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                    }
                }
                return null;
            })()''')
        page.wait_for_timeout(500)

        # ── STEP 2: Set Origin ────────────────────────────────────────
        print(f'STEP 2: Origin = "{origin}"...')
        # Click #fromAirportName using Playwright click (trusted event for Angular)
        find_and_click(r'''(() => {
            const el = document.querySelector('#fromAirportName') ||
                       document.querySelector('a[id*="from" i]') ||
                       document.querySelector('[aria-label*="From" i]');
            if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
                el.scrollIntoView({block: 'center'});
                const r = el.getBoundingClientRect();
                return {x: r.x + r.width/2, y: r.y + r.height/2};
            }
            return null;
        })()''')
        print("  Clicked From field")
        page.wait_for_timeout(2000)

        # Find #search_input inside the airport modal and click it
        find_and_click(r'''(() => {
            const modals = document.querySelectorAll('ngc-airport-lookup-modal, modal-container, [class*="modal-body"], [class*="modal-content"]');
            for (const modal of modals) {
                if (!(modal.offsetParent !== null || modal.getClientRects().length > 0)) continue;
                const inputs = modal.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[placeholder]');
                for (const inp of inputs) {
                    if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
                    const id = (inp.id || '').toLowerCase();
                    if (id.includes('date') || id.includes('return') || id.includes('depart') || id.includes('confirmation') || id.includes('promo')) continue;
                    const r = inp.getBoundingClientRect();
                    if (r.width > 50 && r.height > 15)
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        print("  Focused modal search input")
        page.wait_for_timeout(300)

        page.keyboard.press("Control+a")
        page.keyboard.type(origin, delay=50)
        print(f'  Typed "{origin}"')
        page.wait_for_timeout(3000)

        # Click the first suggestion containing SEA/Seattle
        clicked = find_and_click(r'''(() => {
            const containers = document.querySelectorAll(
                'ngc-airport-lookup-modal, modal-container, [class*="modal"], [class*="airport-list"], [class*="suggestion"], ul, ol'
            );
            for (const container of containers) {
                if (!(container.offsetParent !== null || container.getClientRects().length > 0)) continue;
                const items = container.querySelectorAll('li, a, [role="option"], [class*="airport"], [class*="city"], button');
                for (const item of items) {
                    const text = (item.textContent || '').trim();
                    if (text.length < 3 || text.length > 200) continue;
                    if (!/\bSEA\b/.test(text) && !/Seattle/i.test(text)) continue;
                    const lower = text.toLowerCase();
                    if (lower === 'search' || lower === 'close' || lower === 'clear') continue;
                    const r = item.getBoundingClientRect();
                    if (r.width > 30 && r.height > 15 && r.y > 0 && r.y < window.innerHeight)
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        if clicked:
            print("  Selected origin suggestion (SEA)")
        else:
            page.keyboard.press("Enter")
            print("  Pressed Enter (no dropdown)")
        page.wait_for_timeout(1500)

        # ── STEP 3: Set Destination ───────────────────────────────────
        print(f'STEP 3: Destination = "{destination}"...')
        find_and_click(r'''(() => {
            const el = document.querySelector('#toAirportName') ||
                       document.querySelector('a[id*="toAirport" i]') ||
                       document.querySelector('[aria-label*="To" i]');
            if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
                el.scrollIntoView({block: 'center'});
                const r = el.getBoundingClientRect();
                return {x: r.x + r.width/2, y: r.y + r.height/2};
            }
            return null;
        })()''')
        print("  Clicked To field")
        page.wait_for_timeout(2000)

        find_and_click(r'''(() => {
            const modals = document.querySelectorAll('ngc-airport-lookup-modal, modal-container, [class*="modal-body"], [class*="modal-content"]');
            for (const modal of modals) {
                if (!(modal.offsetParent !== null || modal.getClientRects().length > 0)) continue;
                const inputs = modal.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[placeholder]');
                for (const inp of inputs) {
                    if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
                    const id = (inp.id || '').toLowerCase();
                    if (id.includes('date') || id.includes('return') || id.includes('depart') || id.includes('confirmation') || id.includes('promo')) continue;
                    const r = inp.getBoundingClientRect();
                    if (r.width > 50 && r.height > 15)
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        print("  Focused modal search input")
        page.wait_for_timeout(300)

        page.keyboard.press("Control+a")
        page.keyboard.type(destination, delay=50)
        print(f'  Typed "{destination}"')
        page.wait_for_timeout(3000)

        clicked = find_and_click(r'''(() => {
            const containers = document.querySelectorAll(
                'ngc-airport-lookup-modal, modal-container, [class*="modal"], [class*="airport-list"], [class*="suggestion"], ul, ol'
            );
            for (const container of containers) {
                if (!(container.offsetParent !== null || container.getClientRects().length > 0)) continue;
                const items = container.querySelectorAll('li, a, [role="option"], [class*="airport"], [class*="city"], button');
                for (const item of items) {
                    const text = (item.textContent || '').trim();
                    if (text.length < 3 || text.length > 200) continue;
                    if (!/\bCHI\b/.test(text) && !/Chicago/i.test(text) && !/\bORD\b/.test(text)) continue;
                    const lower = text.toLowerCase();
                    if (lower === 'search' || lower === 'close' || lower === 'clear') continue;
                    const r = item.getBoundingClientRect();
                    if (r.width > 30 && r.height > 15 && r.y > 0 && r.y < window.innerHeight)
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        if clicked:
            print("  Selected destination suggestion (CHI)")
        else:
            page.keyboard.press("Enter")
            print("  Pressed Enter (no dropdown)")
        page.wait_for_timeout(1500)

        # ── STEP 4: Set Dates ─────────────────────────────────────────
        print(f"STEP 4: Dates — Dep: {departure_date}, Ret: {return_date}...")
        # Open the calendar
        find_and_click(r'''(() => {
            const selectors = ['#calDepartLabelCont', '#input_departureDate_1',
                '[id*="depart" i][id*="date" i]', '[aria-label*="Depart" i]', '[class*="calendar" i]'];
            for (const sel of selectors) {
                const el = document.querySelector(sel);
                if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
                    const r = el.getBoundingClientRect();
                    return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        print("  Opened calendar")
        page.wait_for_timeout(2000)

        # Navigate to departure month
        for _ in range(12):
            displayed = read_calendar_month()
            print(f"  Calendar shows: \"{displayed}\" (need: \"{dep_month_name} {dep_y}\")")
            if displayed and dep_month_name.lower() in displayed.lower() and str(dep_y) in displayed:
                print("  Correct month displayed")
                break
            if not click_next_month():
                print("  WARNING: next arrow not found")
                break
            page.wait_for_timeout(800)

        # Click departure day
        if click_day(dep_d, dep_month_name, dep_y):
            print(f"  Selected departure: {dep_month_name} {dep_d}, {dep_y}")
        else:
            print(f"  WARNING: could not click departure day {dep_d}")
        page.wait_for_timeout(1500)

        # Navigate to return month if different
        if ret_m != dep_m or ret_y != dep_y:
            for _ in range(6):
                displayed = read_calendar_month()
                if displayed and ret_month_name.lower() in displayed.lower() and str(ret_y) in displayed:
                    break
                click_next_month()
                page.wait_for_timeout(800)

        # Click return day
        if click_day(ret_d, ret_month_name, ret_y):
            print(f"  Selected return: {ret_month_name} {ret_d}, {ret_y}")
        else:
            print(f"  WARNING: could not click return day {ret_d}")
        page.wait_for_timeout(1000)

        # Close calendar — click Done
        find_and_click(r'''(() => {
            const btns = document.querySelectorAll('button');
            for (const btn of btns) {
                const txt = (btn.textContent || '').trim().toLowerCase();
                if ((txt === 'done' || txt === 'apply' || txt === 'close') && (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
                    const r = btn.getBoundingClientRect();
                    return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        print("  Closed calendar")
        page.wait_for_timeout(500)

        # ── STEP 5: Search ────────────────────────────────────────────
        print("STEP 5: Searching for flights...")
        find_and_click(r'''(() => {
            const btns = document.querySelectorAll('button, input[type="submit"]');
            for (const btn of btns) {
                const txt = (btn.textContent || btn.value || '').trim().toLowerCase();
                const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
                const id = (btn.id || '').toLowerCase();
                if ((txt.includes('submit') || txt.includes('search') || aria.includes('search') || id.includes('submit') || id.includes('search')) &&
                    !txt.includes('clear') && !txt.includes('reset') &&
                    (btn.offsetParent !== null || btn.getClientRects().length > 0)) {
                    const r = btn.getBoundingClientRect();
                    if (r.width > 30 && r.height > 20)
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
            }
            return null;
        })()''')
        print("  Clicked search button")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(12000)

        try:
            page.locator('span:has-text("$")').first.wait_for(
                state="visible", timeout=15000
            )
            print("  Results loaded (price found)")
        except Exception:
            print("  Timeout waiting for price — continuing anyway")
        print(f"  URL: {page.url}")

        # ── STEP 6: Extract flights ──────────────────────────────────
        print(f"STEP 6: Extract up to {max_results} flights...")

        # Scroll to load lazy content
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(800)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # DOM extraction using .mach-flight-card (Delta Angular component)
        js_flights = page.evaluate(r'''((maxResults) => {
            const flights = [];
            const seen = new Set();
            const cardSelectors = [
                '.mach-flight-card',
                '[class*="mach-flight-card"]',
                '.flight-results-grid__flight-card',
                '[class*="flightCard"]:not([class*="flight-cards"])',
                '[data-testid*="flight"]',
                '[class*="flight-listing"]',
                '[class*="bound"]', '[class*="slice"]',
                'li[class*="result"]', 'div[class*="result"]',
                '[class*="card-body"]',
                '[class*="flight-card"]',
            ];
            let cards = [];
            for (const sel of cardSelectors) {
                try {
                    const c = document.querySelectorAll(sel);
                    if (c.length >= 1 && c.length <= 50) { cards = c; break; }
                } catch (e) {}
            }
            if (cards.length === 0) {
                for (const sel of cardSelectors) {
                    try {
                        const c = document.querySelectorAll(sel);
                        if (c.length > 0) { cards = c; break; }
                    } catch (e) {}
                }
            }
            for (const card of Array.from(cards).slice(0, maxResults * 2)) {
                const text = (card.textContent || '').replace(/\s+/g, ' ').trim();
                if (text.length < 10) continue;
                const priceMatch = text.match(/\$\d{1,5}/);
                const price = priceMatch ? priceMatch[0] : 'N/A';
                const timeMatches = text.match(/\d{1,2}:\d{2}\s*[AaPp][Mm]/g) || [];
                const depTime = timeMatches[0] || '';
                const arrTime = timeMatches[1] || '';
                const stopsMatch = text.match(/(Nonstop|Non-stop|\d+\s*stop[s]?)/i);
                const stops = stopsMatch ? stopsMatch[0] : '';
                const durMatch = text.match(/(\d+h\s*\d*m?|\d+\s*hr\s*\d*\s*min)/i);
                const duration = durMatch ? durMatch[0] : '';
                const flightMatch = text.match(/(?:DL|Delta)\s*\d{1,4}/i);
                const flightNum = flightMatch ? flightMatch[0] : '';
                const itinerary = [depTime, arrTime, stops, duration, flightNum].filter(Boolean).join(' | ') || text.substring(0, 120);
                const key = depTime + '|' + arrTime + '|' + stops + '|' + price;
                if (seen.has(key) && key !== '|||N/A') continue;
                seen.add(key);
                if (price !== 'N/A' || depTime)
                    flights.push({itinerary: itinerary, price: price});
                if (flights.length >= maxResults) break;
            }
            return flights;
        })(''' + str(max_results) + ')')

        results = [{"itinerary": f["itinerary"], "price": f["price"]} for f in js_flights]
        print(f"  DOM extraction: {len(results)} flights")

        # Fallback: body text regex
        if not results:
            print("  Using body text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            seen_flights = set()
            buf = []
            for line in body_text.split('\n'):
                line = line.strip()
                if not line:
                    continue
                pm = re.search(r'\$[\d,]+', line)
                if pm:
                    if buf:
                        itinerary = " | ".join(buf[-5:])
                        price = pm.group(0)
                        fk = f"{itinerary}_{price}".lower()
                        if fk not in seen_flights:
                            seen_flights.add(fk)
                            results.append({"itinerary": itinerary, "price": price})
                            if len(results) >= max_results:
                                break
                    buf = []
                else:
                    buf.append(line)

        # ── Print results ─────────────────────────────────────────────
        print(f"\nFound {len(results)} flights ({origin} → {destination}):")
        print(f"  Departure: {departure_date}  Return: {return_date}\n")
        for i, item in enumerate(results, 1):
            print(f"  {i}. {item['itinerary']}")
            print(f"     Price: {item['price']}")

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        context.close()

    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"\nTotal flights found: {len(items)}")
