"""
Auto-generated Playwright script (Python)
Google Flights – Round Trip Flight Search (v2)
Origin: Seattle → Destination: Chicago
Departure: 04/26/2026  Return: 04/30/2026

Generated on: 2026-02-26T23:56:27.152Z
Recorded 8 browser interactions

Steps 1-5: Deterministic Playwright locators (no AI).
Step 6: Uses JS extraction to find flight number, itinerary, and price.
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


def compute_dates():
    today = date.today()
    departure = today + relativedelta(months=2)
    ret = departure + timedelta(days=4)
    return departure, ret


def run(
    playwright: Playwright,
    origin: str = "Seattle",
    destination: str = "Chicago",
    max_results: int = 5,
) -> list:
    departure, return_date = compute_dates()
    dep_str = departure.strftime("%Y-%m-%d")
    ret_str = return_date.strftime("%Y-%m-%d")
    dep_display = departure.strftime("%m/%d/%Y")
    ret_display = return_date.strftime("%m/%d/%Y")

    print(f"  {origin} → {destination}")
    print(f"  Departure: {dep_display}  Return: {ret_display}\n")

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
        page.goto("https://www.google.com/travel/flights")
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
            origin_el = page.locator(
                'div[aria-label*="Where from" i], '
                'input[aria-label*="Where from" i]'
            ).first
            origin_el.evaluate("el => el.click()")
            page.wait_for_timeout(500)
            page.keyboard.press("Control+a")
            page.wait_for_timeout(200)
            page.keyboard.type(origin, delay=50)
            print(f'  Typed "{origin}"')
            page.wait_for_timeout(1500)
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

            dep_day = departure.day
            dep_month_name = departure.strftime("%B")
            dep_clicked = page.evaluate(f'''() => {{
                const candidates = [];
                const btns = document.querySelectorAll('[role="button"]');
                for (const btn of btns) {{
                    const firstLine = (btn.innerText || '').split('\\n')[0].trim();
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
                            const txt = (el.innerText || '').split('\\n')[0].trim();
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
                    const firstLine = (btn.innerText || '').split('\\n')[0].trim();
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
                            const txt = (el.innerText || '').split('\\n')[0].trim();
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

        # ── STEP 6: Extract flights with card expansion ──────────────────
        print(f"STEP 6: Extract up to {max_results} flights...")
        print("  (Expanding each card to find flight numbers)\n")

        # IATA airline codes for regex matching
        # NOTE: "AM" excluded — false positives from time strings like "7:15 AM"
        airline_codes = [
            "AA","AS","B6","DL","F9","G4","HA","NK","UA","WN",
            "AC","WS","BA","LH","AF","KL","IB","SK","AY","LX",
            "QF","NZ","SQ","CX","NH","JL","KE","OZ",
            "EK","QR","EY","TK","ET","LA","AV","CM",
        ]

        # 6a: Extract basic info (airline, itinerary, price) from summary cards
        print("  Extracting basic flight info from result cards...")
        basic_flights = page.evaluate(r'''() => {
            const results = [];
            const items = document.querySelectorAll('li');
            for (const item of items) {
                const text = item.innerText || '';
                if (text.length < 20 || text.length > 500) continue;
                const priceMatch = text.match(/\$[\d,]+/);
                if (!priceMatch) continue;
                if (!/\d{1,2}[:\u2236]\d{2}/.test(text)) continue;
                const lines = text.split('\n').map(l => l.trim()).filter(l => l);
                let airline = 'Unknown';
                const airlineNames = ['Alaska', 'United', 'Delta', 'American', 'Southwest',
                    'JetBlue', 'Spirit', 'Frontier', 'Hawaiian', 'Air Canada'];
                for (const name of airlineNames) {
                    if (text.includes(name)) { airline = name; break; }
                }
                const itinParts = [];
                for (const line of lines) {
                    if (/\d{1,2}:\d{2}/.test(line) && line.length < 80) {
                        itinParts.push(line);
                    }
                }
                let itinerary = itinParts.join(' | ');
                const durMatch = text.match(/(\d+ hr \d+ min|\d+ hr|\d+ min)/);
                if (durMatch && !itinerary.includes(durMatch[0])) {
                    itinerary += ' | ' + durMatch[0];
                }
                results.push({
                    airline: airline,
                    itinerary: itinerary || lines.slice(0, 3).join(' | '),
                    price: priceMatch[0],
                });
                if (results.length >= 10) break;
            }
            return results;
        }''')
        print(f"  Found {len(basic_flights)} flight cards")

        # 6b: Find expand toggles for each flight card
        print("\n  Finding expand toggles for each flight card...")
        toggle_infos = page.evaluate(r'''() => {
            function getXPath(el) {
                const parts = [];
                while (el && el !== document.documentElement && el !== document) {
                    let idx = 1;
                    let sib = el.previousElementSibling;
                    while (sib) {
                        if (sib.tagName === el.tagName) idx++;
                        sib = sib.previousElementSibling;
                    }
                    parts.unshift(el.tagName.toLowerCase() + '[' + idx + ']');
                    el = el.parentElement;
                }
                return '/html/' + parts.join('/');
            }
            const allLi = Array.from(document.querySelectorAll('ul > li'));
            const flightLis = allLi.filter(li => {
                const t = li.innerText || '';
                return /\d{1,2}:\d{2}/.test(t) && t.length > 30 && t.length < 800;
            });
            return flightLis.map((li, idx) => {
                const toggle = li.querySelector('[aria-expanded]');
                if (!toggle) return { idx: idx, hasToggle: false, xpath: '', expanded: '', tag: '', snippet: '' };
                return {
                    idx: idx,
                    hasToggle: true,
                    xpath: getXPath(toggle),
                    expanded: toggle.getAttribute('aria-expanded'),
                    tag: toggle.tagName.toLowerCase(),
                    snippet: (li.innerText || '').substring(0, 60).replace(/\n/g, ' '),
                };
            });
        }''')
        toggles_with = [t for t in toggle_infos if t.get('hasToggle')]
        print(f"  Found {len(toggle_infos)} cards, {len(toggles_with)} with toggles")
        for t in toggle_infos[:6]:
            status = f"toggle {t['tag']} expanded={t['expanded']}" if t.get('hasToggle') else "no toggle"
            print(f"    [{t['idx']}] {status} — {t.get('snippet', '')}")

        # 6c: Expand each card, snapshot spans before/after, diff for flight numbers
        card_count = min(len(basic_flights), max_results)
        for i in range(card_count):
            basic = basic_flights[i]
            print(f"\n  [{i+1}/{card_count}] Expanding: {basic['airline']} {basic['itinerary']} — {basic['price']}")

            try:
                # Snapshot flight-number spans BEFORE expanding
                spans_before = page.evaluate(r'''(codes) => {
                    const codeSet = new Set(codes);
                    const nums = [];
                    for (const sp of document.querySelectorAll('span')) {
                        const t = (sp.textContent || '').trim();
                        if (/^[A-Z]{2}\s*\d{1,4}$/.test(t) && codeSet.has(t.substring(0, 2)))
                            nums.push(t.replace(/\s+/g, ' '));
                    }
                    return nums;
                }''', airline_codes)
                spans_before_set = set(spans_before)

                text_before_len = page.evaluate('() => (document.body.innerText || "").length')

                # Click the expand toggle deterministically via XPath
                toggle_info = toggle_infos[i] if i < len(toggle_infos) else None
                if toggle_info and toggle_info.get('hasToggle'):
                    xpath = toggle_info['xpath']
                    print(f"    Clicking toggle: xpath={xpath}")
                    try:
                        page.locator(f"xpath={xpath}").evaluate("el => el.click()")
                    except Exception as click_err:
                        print(f"    locator.click failed: {click_err}, trying JS click...")
                        page.evaluate(r'''(xp) => {
                            const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                            if (r.singleNodeValue) r.singleNodeValue.click();
                        }''', xpath)
                else:
                    print(f"    No toggle found for card {i+1}, skipping expansion")

                page.wait_for_timeout(3000)

                # Check expansion success via DOM text length delta
                after_len = page.evaluate('() => (document.body.innerText || "").length')
                delta = after_len - text_before_len
                print(f"    DOM delta after click: {'+' if delta > 0 else ''}{delta} chars")

                if delta <= 0 and toggle_info and toggle_info.get('hasToggle'):
                    print("    Didn't expand, clicking toggle again...")
                    try:
                        page.locator(f"xpath={toggle_info['xpath']}").evaluate("el => el.click()")
                    except Exception:
                        page.evaluate(r'''(xp) => {
                            const r = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                            if (r.singleNodeValue) r.singleNodeValue.click();
                        }''', toggle_info['xpath'])
                    page.wait_for_timeout(3000)

                # Snapshot spans AFTER expansion
                spans_after = page.evaluate(r'''(codes) => {
                    const codeSet = new Set(codes);
                    const nums = [];
                    for (const sp of document.querySelectorAll('span')) {
                        const t = (sp.textContent || '').trim();
                        if (/^[A-Z]{2}\s*\d{1,4}$/.test(t) && codeSet.has(t.substring(0, 2)))
                            nums.push(t.replace(/\s+/g, ' '));
                    }
                    return nums;
                }''', airline_codes)

                # Diff: find NEW flight numbers that appeared after expansion
                new_spans = [s for s in spans_after if s not in spans_before_set]
                unique_new = list(dict.fromkeys(new_spans))  # preserve order, dedupe
                print(f"    Spans before: {spans_before}")
                print(f"    Spans after:  {spans_after}")
                print(f"    New spans:    {unique_new}")

                flight_num = 'N/A'
                if unique_new:
                    flight_num = ' / '.join(unique_new[:3])

                # Fallback: full-text regex scan for new flight numbers
                if flight_num == 'N/A' and delta > 100:
                    body_text = page.evaluate('() => document.body.innerText || ""')
                    full_text_nums = set()
                    code_set = set(airline_codes)
                    for m in re.finditer(r'\b([A-Z]{2})\s+(\d{1,4})\b', body_text):
                        code = m.group(1)
                        if code in code_set:
                            fnum = f"{code} {m.group(2)}"
                            if fnum not in spans_before_set:
                                full_text_nums.add(fnum)
                    for m in re.finditer(r'\b([A-Z]{2})(\d{3,4})\b', body_text):
                        code = m.group(1)
                        if code in code_set:
                            fnum = f"{code} {m.group(2)}"
                            if fnum not in spans_before_set:
                                full_text_nums.add(fnum)
                    if full_text_nums:
                        flight_num = ' / '.join(list(full_text_nums)[:3])

                print(f"    Flight number: {flight_num}")

                results.append({
                    'flightNumber': flight_num,
                    'itinerary': f"{basic['airline']} · {basic['itinerary']}",
                    'price': basic['price'],
                })

                # Collapse the card (click same toggle again)
                if toggle_info and toggle_info.get('hasToggle'):
                    try:
                        page.locator(f"xpath={toggle_info['xpath']}").evaluate("el => el.click()")
                        page.wait_for_timeout(1500)
                    except Exception:
                        page.keyboard.press("Escape")
                        page.wait_for_timeout(1000)
                else:
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(1000)

            except Exception as card_err:
                print(f"    Failed to expand card {i+1}: {card_err}")
                results.append({
                    'flightNumber': 'N/A',
                    'itinerary': f"{basic['airline']} · {basic['itinerary']}",
                    'price': basic['price'],
                })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\nFound {len(results)} flights ({origin} → {destination}):")
        print(f"  Departure: {dep_display}  Return: {ret_display}\n")
        for i, flight in enumerate(results, 1):
            print(f"  {i}. Flight: {flight['flightNumber']}")
            print(f"     {flight['itinerary']}")
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
        print(f"\nTotal flights found: {len(items)}")
