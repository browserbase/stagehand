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

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


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

    port = get_free_port()
    profile_dir = get_temp_profile_dir("delta_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    # ── Anti-detection: inject before any page loads ──────────────────
    # Akamai Bot Manager checks for chrome.runtime, plugins, webdriver, etc.
    context.add_init_script("""
        // Ensure navigator.webdriver is undefined (double-ensure with CDP flag)
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });

        // Restore chrome object (removed by --disable-extensions)
        if (!window.chrome) {
            window.chrome = {};
        }
        if (!window.chrome.runtime) {
            window.chrome.runtime = {
                connect: function() {},
                sendMessage: function() {},
                onMessage: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
                onConnect: { addListener: function() {}, removeListener: function() {}, hasListener: function() { return false; } },
                id: undefined,
            };
        }
        if (!window.chrome.csi) {
            window.chrome.csi = function() {
                return { startE: Date.now(), onloadT: Date.now(), pageT: Date.now() - performance.timing.navigationStart, tran: 15 };
            };
        }
        if (!window.chrome.loadTimes) {
            window.chrome.loadTimes = function() {
                return {
                    commitLoadTime: Date.now() / 1000,
                    connectionInfo: 'h2',
                    finishDocumentLoadTime: Date.now() / 1000,
                    finishLoadTime: Date.now() / 1000,
                    firstPaintAfterLoadTime: 0,
                    firstPaintTime: Date.now() / 1000,
                    navigationType: 'Other',
                    npnNegotiatedProtocol: 'h2',
                    requestTime: Date.now() / 1000,
                    startLoadTime: Date.now() / 1000,
                    wasAlternateProtocolAvailable: false,
                    wasFetchedViaSpdy: true,
                    wasNpnNegotiated: true,
                };
            };
        }

        // Fix plugins (empty with --disable-extensions)
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const plugins = [
                    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
                    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
                ];
                plugins.length = 3;
                return plugins;
            },
        });

        // Fix permissions query (Akamai checks this)
        const origQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                origQuery(parameters)
        );
    """)

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
                    btn.evaluate("el => el.click()")
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
        page.wait_for_timeout(3000)

        # Find search input inside the airport modal — retry up to 3 times
        modal_found = False
        for attempt in range(3):
            modal_found = find_and_click(r'''(() => {
                // Check for predictive_search inputs first (Delta pattern)
                const predInputs = document.querySelectorAll('input[id*="predictive_search"]');
                for (const inp of predInputs) {
                    if (inp.offsetParent !== null || inp.getClientRects().length > 0) {
                        const r = inp.getBoundingClientRect();
                        if (r.width > 50 && r.height > 15)
                            return {x: r.x + r.width/2, y: r.y + r.height/2};
                    }
                }
                const modals = document.querySelectorAll('ngc-airport-lookup-modal, modal-container, [class*="modal-body"], [class*="modal-content"], [class*="airport-lookup"]');
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
                // Broadest fallback: any visible text input on screen
                const allInputs = document.querySelectorAll('input[type="text"], input[type="search"], input:not([type])');
                for (const inp of allInputs) {
                    if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
                    const id = (inp.id || '').toLowerCase();
                    if (id.includes('date') || id.includes('return') || id.includes('depart') || id.includes('confirmation') || id.includes('promo') || id.includes('password') || id.includes('email')) continue;
                    const r = inp.getBoundingClientRect();
                    if (r.width > 100 && r.height > 15 && r.y > 50 && r.y < window.innerHeight)
                        return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
                return null;
            })()''')
            if modal_found:
                break
            print(f"  Modal input not found (attempt {attempt+1}/3) — waiting...")
            page.wait_for_timeout(2000)
        if modal_found:
            print("  Focused modal search input")
            page.wait_for_timeout(300)
            # Only Ctrl+A inside the confirmed modal input — safe to clear
            page.keyboard.press("Control+a")
            page.keyboard.type(origin, delay=50)
            print(f'  Typed "{origin}"')
        else:
            print("  WARNING: modal search input not found — typing anyway")
            page.keyboard.type(origin, delay=50)
            print(f'  Typed "{origin}"')
        page.wait_for_timeout(3000)

        # Click the first suggestion containing SEA/Seattle — use element.click() for Angular
        clicked = page.evaluate(r'''(() => {
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
                    if (r.width > 30 && r.height > 15 && r.y > 0 && r.y < window.innerHeight) {
                        item.click();  // Use element.click() for Angular event binding
                        return true;
                    }
                }
            }
            return false;
        })()''')
        if clicked:
            print("  Selected origin suggestion (SEA) via element.click()")
        else:
            page.keyboard.press("Enter")
            print("  Pressed Enter (no dropdown)")
        page.wait_for_timeout(2000)

        # Verify origin is actually set — if not, try pressing Enter as fallback
        origin_quick_check = page.evaluate(r'''() => {
            const el = document.querySelector('#fromAirportName') || document.querySelector('a[id*="fromAirport"]');
            return el ? (el.textContent || '').trim() : '';
        }''')
        if 'SEA' not in origin_quick_check and 'Seattle' not in origin_quick_check:
            print(f"  Origin still not set (\"{origin_quick_check}\") — trying Enter key")
            page.keyboard.press("Enter")
            page.wait_for_timeout(2000)

        # ── After origin selection, check modal state ────────────────
        # Delta may auto-open the destination modal after origin selection.
        # Do NOT press Escape — that cancels the origin selection!
        # Instead, check if a modal is open and whether it's destination or origin.
        post_origin_modal = page.evaluate(r'''() => {
            const modals = document.querySelectorAll('ngc-airport-lookup-modal, modal-container, [class*="modal-body"], [class*="modal-content"], [class*="airport-lookup"]');
            for (const modal of modals) {
                if (!(modal.offsetParent !== null || modal.getClientRects().length > 0)) continue;
                const text = (modal.textContent || '').substring(0, 300).toLowerCase();
                const isDestination = text.includes('destination') || text.includes('where to') || text.includes('select destination');
                const isOrigin = text.includes('select origin') || text.includes('where from') || text.includes('origin city');
                const inputs = modal.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[placeholder]');
                for (const inp of inputs) {
                    if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
                    const id = (inp.id || '').toLowerCase();
                    if (id.includes('date') || id.includes('return') || id.includes('depart')) continue;
                    const r = inp.getBoundingClientRect();
                    if (r.width > 50 && r.height > 15)
                        return {x: r.x + r.width/2, y: r.y + r.height/2, isDestination: isDestination, isOrigin: isOrigin, modalText: text.substring(0, 100)};
                }
            }
            return null;
        }''')

        # Verify origin is set
        origin_check = page.evaluate(r'''() => {
            const el = document.querySelector('#fromAirportName') || document.querySelector('a[id*="fromAirport"]');
            return el ? (el.textContent || '').trim() : '';
        }''')
        print(f"  Origin field now shows: \"{origin_check}\"")

        if post_origin_modal:
            print(f"  Modal still open after origin: isDestination={post_origin_modal.get('isDestination')}, isOrigin={post_origin_modal.get('isOrigin')}")

        # ── STEP 3: Set Destination ───────────────────────────────────
        print(f'STEP 3: Destination = "{destination}"...')

        # If destination modal is already open from origin auto-transition, use it directly
        if post_origin_modal and post_origin_modal.get('isDestination') and not post_origin_modal.get('isOrigin'):
            print("  Destination modal auto-opened — typing directly")
            page.mouse.click(post_origin_modal['x'], post_origin_modal['y'])
            page.wait_for_timeout(300)
            page.keyboard.press("Control+a")
            page.keyboard.type(destination, delay=50)
            print(f'  Typed "{destination}"')
        else:
            # Close any stale modal by clicking outside it (NOT Escape — that cancels origin)
            if post_origin_modal:
                print(f"  Modal open but isDestination={post_origin_modal.get('isDestination')}, isOrigin={post_origin_modal.get('isOrigin')} — clicking outside to dismiss")
                # Click on the page body far from the modal
                page.mouse.click(10, 10)
                page.wait_for_timeout(1500)

            # Click on #toAirportName or the "To"/"Destination" element
            to_clicked = find_and_click(r'''(() => {
                let el = document.querySelector('#toAirportName');
                if (!el) el = document.querySelector('a[id*="toAirport" i]');
                if (!el) el = document.querySelector('button[id*="toAirport" i]');
                // Fallback: look for short "To" / "Destination" text elements
                if (!el) {
                    const candidates = document.querySelectorAll('a, button, span, label');
                    for (const c of candidates) {
                        const text = (c.textContent || '').trim();
                        const aria = (c.getAttribute('aria-label') || '').toLowerCase();
                        const r = c.getBoundingClientRect();
                        if (aria.includes('swap') || aria.includes('exchange') || aria.includes('switch') || aria.includes('reverse')) continue;
                        if (r.y > 400 || r.y < 0 || r.width < 20 || r.height < 10) continue;
                        if (!(c.offsetParent !== null || c.getClientRects().length > 0)) continue;
                        if (text.length > 20) continue;
                        if (/\b[A-Z]{3}\b/.test(text)) continue;
                        if (text.toLowerCase() === 'to' || text.toLowerCase() === 'destination' || text.toLowerCase() === 'to destination') {
                            el = c;
                            break;
                        }
                    }
                }
                if (el && (el.offsetParent !== null || el.getClientRects().length > 0)) {
                    el.scrollIntoView({block: 'center'});
                    const r = el.getBoundingClientRect();
                    return {x: r.x + r.width/2, y: r.y + r.height/2};
                }
                return null;
            })()''')
            if to_clicked:
                print("  Clicked To field")
            else:
                print("  WARNING: To field not found via DOM")
            page.wait_for_timeout(3000)

            # Now find the modal input — retry up to 3 times, verify it's DESTINATION
            modal_info = None
            for attempt in range(3):
                modal_info = page.evaluate(r'''() => {
                const modals = document.querySelectorAll('ngc-airport-lookup-modal, modal-container, [class*="modal-body"], [class*="modal-content"], [class*="airport-lookup"]');
                for (const modal of modals) {
                    if (!(modal.offsetParent !== null || modal.getClientRects().length > 0)) continue;
                    const text = (modal.textContent || '').substring(0, 300).toLowerCase();
                    const isDestination = text.includes('destination') || text.includes('where to') || text.includes('select destination');
                    const isOrigin = text.includes('select origin') || text.includes('where from');
                    const inputs = modal.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[placeholder]');
                    for (const inp of inputs) {
                        if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
                        const id = (inp.id || '').toLowerCase();
                        if (id.includes('date') || id.includes('return') || id.includes('depart') || id.includes('confirmation') || id.includes('promo')) continue;
                        const r = inp.getBoundingClientRect();
                        if (r.width > 50 && r.height > 15)
                            return {x: r.x + r.width/2, y: r.y + r.height/2, isDestination: isDestination, isOrigin: isOrigin, modalText: text.substring(0, 100)};
                    }
                }
                const predInputs = document.querySelectorAll('input[id*="predictive_search"]');
                for (const inp of predInputs) {
                    if (inp.offsetParent !== null || inp.getClientRects().length > 0) {
                        const r = inp.getBoundingClientRect();
                        return {x: r.x + r.width/2, y: r.y + r.height/2, isDestination: false, isOrigin: false, modalText: 'predictive_search'};
                    }
                }
                return null;
            }''')
                if modal_info:
                    break
                print(f"  Destination modal not found (attempt {attempt+1}/3) — waiting...")
                page.wait_for_timeout(2000)

            if modal_info:
                print(f"  Modal found: isDestination={modal_info.get('isDestination')}, isOrigin={modal_info.get('isOrigin')}")
                print(f"  Modal text: \"{modal_info.get('modalText', '')}\"")
                if modal_info.get('isOrigin') and not modal_info.get('isDestination'):
                    # WRONG modal! Close it and try clicking To again
                    print("  WARNING: This is the ORIGIN modal! Closing and retrying...")
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(1500)
                    # Try clicking #toAirportName directly via element.click()
                    page.evaluate(r'''() => {
                        const el = document.querySelector('#toAirportName');
                        if (el) el.click();
                    }''')
                    page.wait_for_timeout(2000)
                    # Re-detect modal
                    modal_info = page.evaluate(r'''() => {
                        const modals = document.querySelectorAll('ngc-airport-lookup-modal, modal-container, [class*="modal-body"], [class*="modal-content"], [class*="airport-lookup"]');
                        for (const modal of modals) {
                            if (!(modal.offsetParent !== null || modal.getClientRects().length > 0)) continue;
                            const inputs = modal.querySelectorAll('input[type="text"], input[type="search"], input:not([type]), input[placeholder]');
                            for (const inp of inputs) {
                                if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
                                const id = (inp.id || '').toLowerCase();
                                if (id.includes('date') || id.includes('return') || id.includes('depart')) continue;
                                const r = inp.getBoundingClientRect();
                                if (r.width > 50 && r.height > 15)
                                    return {x: r.x + r.width/2, y: r.y + r.height/2};
                            }
                        }
                        return null;
                    }''')

                if modal_info:
                    page.mouse.click(modal_info['x'], modal_info['y'])
                    print("  Focused modal search input")
                    page.wait_for_timeout(300)
                    page.keyboard.press("Control+a")
                    page.keyboard.type(destination, delay=50)
                    print(f'  Typed "{destination}"')
                else:
                    print("  WARNING: modal search input not found — typing anyway")
                    page.keyboard.type(destination, delay=50)
                    print(f'  Typed "{destination}"')
            else:
                print("  WARNING: No modal found at all — typing anyway")
                page.keyboard.type(destination, delay=50)
                print(f'  Typed "{destination}"')
        page.wait_for_timeout(3000)

        clicked = page.evaluate(r'''(() => {
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
                    if (r.width > 30 && r.height > 15 && r.y > 0 && r.y < window.innerHeight) {
                        item.click();  // Use element.click() for Angular event binding
                        return true;
                    }
                }
            }
            return false;
        })()''')
        if clicked:
            print("  Selected destination suggestion (CHI) via element.click()")
        else:
            page.keyboard.press("Enter")
            print("  Pressed Enter (no dropdown)")
        page.wait_for_timeout(2000)

        # Verify destination is set — if not, try pressing Enter as fallback
        dest_quick_check = page.evaluate(r'''() => {
            const el = document.querySelector('#toAirportName') || document.querySelector('a[id*="toAirport"]');
            return el ? (el.textContent || '').trim() : '';
        }''')
        if 'CHI' not in dest_quick_check and 'Chicago' not in dest_quick_check and 'ORD' not in dest_quick_check:
            print(f"  Destination still not set (\"{dest_quick_check}\") — trying Enter key")
            page.keyboard.press("Enter")
            page.wait_for_timeout(2000)
            dest_quick_check = page.evaluate(r'''() => {
                const el = document.querySelector('#toAirportName') || document.querySelector('a[id*="toAirport"]');
                return el ? (el.textContent || '').trim() : '';
            }''')
            print(f"  Destination field now: \"{dest_quick_check}\"")
        else:
            print(f"  Destination set: \"{dest_quick_check}\"")
        page.wait_for_timeout(500)

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

        # ── Verify form state before searching ─────────────────────────
        print("Verifying form state...")
        form_info = page.evaluate(r'''() => {
            const info = [];
            const airportFields = ['#fromAirportName', '#toAirportName', 'a[id*="fromAirport"]', 'a[id*="toAirport"]'];
            for (const sel of airportFields) {
                const els = document.querySelectorAll(sel);
                for (const el of els) {
                    if (el.offsetParent !== null || el.getClientRects().length > 0) {
                        const text = (el.textContent || el.innerText || '').trim();
                        if (text) info.push({id: el.id || sel, text: text.substring(0, 80)});
                    }
                }
            }
            const errors = document.querySelectorAll('[class*="error" i], [class*="invalid" i], [role="alert"]');
            for (const err of errors) {
                if (err.offsetParent !== null || err.getClientRects().length > 0) {
                    const text = (err.textContent || '').trim();
                    if (text && text.length < 200) info.push({id: 'ERROR', text: text.substring(0, 100)});
                }
            }
            return info;
        }''')
        for item in form_info:
            print(f"  {item['id']}: {item['text']}")
        if not form_info:
            print("  WARNING: No form data detected")

        # ── STEP 5: Search ────────────────────────────────────────────
        print("STEP 5: Searching for flights...")

        # Human-like behavior: move mouse around and wait before clicking search
        import random
        for _ in range(3):
            page.mouse.move(random.randint(200, 900), random.randint(200, 600))
            page.wait_for_timeout(random.randint(300, 800))
        page.wait_for_timeout(2000)  # Give Akamai sensor time to complete

        # First, enable the button if disabled
        page.evaluate(r'''() => {
            const btn = document.querySelector('#mach-core-header-search-button') ||
                        document.querySelector('button[id*="search" i]');
            if (btn) { btn.disabled = false; btn.removeAttribute('aria-disabled'); }
        }''')

        # Strategy 1: Playwright native locator click — generates trusted isTrusted=true events
        # This is critical to avoid Access Denied from Delta's bot protection
        search_clicked = False
        try:
            btn_locator = page.locator('#mach-core-header-search-button')
            btn_count = btn_locator.count()
            print(f"  Search button locator count: {btn_count}")
            if btn_count > 0:
                btn_locator.first.scroll_into_view_if_needed(timeout=3000)
                page.wait_for_timeout(500)
                btn_locator.first.click(timeout=5000)
                print("  Clicked search button (Playwright trusted click)")
                search_clicked = True
            else:
                # Debug: check if button exists via evaluate
                btn_exists = page.evaluate(r'''() => {
                    const btn = document.querySelector('#mach-core-header-search-button');
                    if (!btn) return 'not found in DOM';
                    const r = btn.getBoundingClientRect();
                    return `found: ${btn.tagName} disabled=${btn.disabled} visible=${r.width}x${r.height} at (${r.x},${r.y})`;
                }''')
                print(f"  Button DOM check: {btn_exists}")
        except Exception as e:
            print(f"  Playwright click failed: {e}")

        if not search_clicked:
            # Strategy 1b: try other search button selectors with Playwright click
            for sel in ['button[id*="search" i]', 'button:has-text("Search")', 'button:has-text("SEARCH")']:
                try:
                    loc = page.locator(sel)
                    if loc.count() > 0:
                        loc.first.click(timeout=3000)
                        print(f"  Clicked search via locator: {sel}")
                        search_clicked = True
                        break
                except Exception:
                    continue

        page.wait_for_timeout(8000)

        # Check if we navigated away from homepage
        current_url = page.url
        on_homepage = current_url.rstrip('/') == 'https://www.delta.com' or current_url == 'https://www.delta.com/'

        if on_homepage:
            # Strategy 2: Playwright click by position (still trusted events)
            print("  Still on homepage — trying coordinate Playwright click...")
            coords = page.evaluate(r'''(() => {
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
            if coords:
                page.mouse.click(coords['x'], coords['y'])
                print(f"  Coordinate click at ({coords['x']}, {coords['y']})")
            page.wait_for_timeout(8000)
            current_url = page.url
            on_homepage = current_url.rstrip('/') == 'https://www.delta.com' or current_url == 'https://www.delta.com/'

        if on_homepage:
            # Strategy 3: direct URL navigation as last resort
            print("  Still on homepage — trying direct URL navigation...")
            codes = page.evaluate(r'''() => {
                const fromEl = document.querySelector('#fromAirportName') || document.querySelector('a[id*="fromAirport"]');
                const toEl = document.querySelector('#toAirportName') || document.querySelector('a[id*="toAirport"]');
                const fromText = fromEl ? (fromEl.textContent || '').trim() : '';
                const toText = toEl ? (toEl.textContent || '').trim() : '';
                const fromCode = (fromText.match(/\b([A-Z]{3})\b/) || [])[1] || '';
                const toCode = (toText.match(/\b([A-Z]{3})\b/) || [])[1] || '';
                return {fromCode, toCode};
            }''')
            from_code = codes.get('fromCode', '') or 'SEA'
            to_code = codes.get('toCode', '') or 'ORD'
            search_url = f"https://www.delta.com/flight-search/book-a-flight?action=findFlights&tripType=ROUND_TRIP&departureCity={from_code}&destinationCity={to_code}&departureDate={departure_date}&returnDate={return_date}&paxCount=1&passengerType=ADT"
            print(f"  Navigating to: {search_url}")
            page.goto(search_url)
            page.wait_for_load_state("domcontentloaded")
            page.wait_for_timeout(10000)
        else:
            # Give results page time to load flights
            page.wait_for_timeout(5000)

        try:
            page.locator('span:has-text("$")').first.wait_for(
                state="visible", timeout=20000
            )
            print("  Results loaded (price found)")
        except Exception:
            print("  Timeout waiting for price — waiting more...")
            page.wait_for_timeout(10000)
        print(f"  URL: {page.url}")

        # Debug dump: what does the page show?
        page_title = page.title()
        body_snippet = page.evaluate("document.body.innerText.substring(0, 500)")
        print(f"  Page title: {page_title}")
        print(f"  Body snippet: {body_snippet[:300]}")

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
        print(f"\nTotal flights found: {len(items)}")
