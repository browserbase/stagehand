"""
Auto-generated Playwright script (Python)
Alaska Airlines – Round Trip Flight Search
From: Seattle → To: Chicago
Departure: 04/26/2026  Return: 04/30/2026

Generated on: 2026-02-26T20:40:46.528Z
Recorded 12 browser interactions

Uses Playwright's native locator API with built-in shadow DOM piercing
(no coordinate math or page.evaluate hacks required).
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

# Deep shadow DOM traversal helper (evaluated in browser)
DEEP_QUERY_JS = """
function deepQuerySelectorAll(root, selector) {
  let results = Array.from(root.querySelectorAll(selector));
  for (const el of root.querySelectorAll('*')) {
    if (el.shadowRoot) {
      results = results.concat(deepQuerySelectorAll(el.shadowRoot, selector));
    }
  }
  return results;
}
"""


def select_first_visible_option(page, timeout_ms=5000):
    """Find first VISIBLE [role='option'] via deep shadow DOM query and click it."""
    import time
    deadline = time.time() + timeout_ms / 1000
    while time.time() < deadline:
        result = page.evaluate(f"""
            (() => {{
                {DEEP_QUERY_JS}
                const opts = deepQuerySelectorAll(document, '[role="option"]');
                const vis = opts.filter(o => {{
                    const r = o.getBoundingClientRect();
                    return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight;
                }});
                if (vis.length > 0) {{
                    const r = vis[0].getBoundingClientRect();
                    return {{ x: r.x + r.width/2, y: r.y + r.height/2, text: vis[0].textContent.trim().substring(0, 80), count: vis.length }};
                }}
                // Fallback: auro-menuoption
                const items = deepQuerySelectorAll(document, 'auro-menuoption, [role="listbox"] li');
                const v = items.filter(o => {{
                    const r = o.getBoundingClientRect();
                    return r.width > 0 && r.height > 0 && r.top >= 0 && r.top < window.innerHeight;
                }});
                if (v.length > 0) {{
                    const r = v[0].getBoundingClientRect();
                    return {{ x: r.x + r.width/2, y: r.y + r.height/2, text: v[0].textContent.trim().substring(0, 80), count: v.length }};
                }}
                return null;
            }})()
        """)
        if result:
            page.mouse.click(result['x'], result['y'])
            print(f"  Selected: {result['text']} ({result['count']} visible options)")
            return True
        page.wait_for_timeout(300)
    return False


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

    print(f"  Seattle -> Chicago")
    print(f"  Dep: {departure_date}  Ret: {return_date}\n")

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
        page.goto("https://www.alaskaair.com")
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
        # Click first combobox via deep shadow DOM query (coordinate click)
        coords = page.evaluate(f"""
            (() => {{
                {DEEP_QUERY_JS}
                const inputs = deepQuerySelectorAll(document, 'input[role="combobox"]');
                const vis = inputs.filter(i => i.offsetParent !== null || i.getClientRects().length > 0);
                if (vis.length > 0) {{
                    vis[0].scrollIntoView({{ block: 'center' }});
                    vis[0].focus();
                    const r = vis[0].getBoundingClientRect();
                    return {{ x: r.x + r.width/2, y: r.y + r.height/2 }};
                }}
                return null;
            }})()
        """)
        if coords:
            page.mouse.click(coords['x'], coords['y'])
            print(f"  Clicked From combobox at ({int(coords['x'])}, {int(coords['y'])})")
        else:
            print("  ERROR: From combobox not found!")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(origin, delay=50)
        print(f'  Typed "{origin}"')
        page.wait_for_timeout(2000)

        # Select first visible suggestion (deep shadow DOM query)
        if not select_first_visible_option(page):
            page.keyboard.press("Enter")
            print("  No visible option found, pressed Enter")
        page.wait_for_timeout(1500)

        # ── Fill Destination ──────────────────────────────────────────────
        print(f'STEP 4: Destination = "{destination}"...')
        # Click second combobox via deep shadow DOM query
        coords = page.evaluate(f"""
            (() => {{
                {DEEP_QUERY_JS}
                const inputs = deepQuerySelectorAll(document, 'input[role="combobox"]');
                const vis = inputs.filter(i => i.offsetParent !== null || i.getClientRects().length > 0);
                if (vis.length >= 2) {{
                    vis[1].scrollIntoView({{ block: 'center' }});
                    vis[1].focus();
                    const r = vis[1].getBoundingClientRect();
                    return {{ x: r.x + r.width/2, y: r.y + r.height/2 }};
                }}
                return null;
            }})()
        """)
        if coords:
            page.mouse.click(coords['x'], coords['y'])
            print(f"  Clicked To combobox at ({int(coords['x'])}, {int(coords['y'])})")
        else:
            print("  ERROR: To combobox not found!")
        page.wait_for_timeout(500)
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        page.keyboard.type(destination, delay=50)
        print(f'  Typed "{destination}"')
        page.wait_for_timeout(2000)

        # Select first visible suggestion
        if not select_first_visible_option(page):
            page.keyboard.press("Enter")
            print("  No visible option found, pressed Enter")
        page.wait_for_timeout(1500)

        # ── Fill Dates ────────────────────────────────────────────────────
        print(f"STEP 5: Dates — Dep: {departure_date}, Ret: {return_date}...")

        # Find date inputs via deep shadow DOM query
        date_inputs = page.evaluate(f"""
            (() => {{
                {DEEP_QUERY_JS}
                const inputs = deepQuerySelectorAll(document, 'input');
                const results = [];
                for (const inp of inputs) {{
                    if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
                    if (inp.getAttribute('role') === 'combobox') continue;
                    if (['hidden','checkbox','radio','submit'].includes(inp.type)) continue;
                    const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
                    const val = inp.value || '';
                    const id = (inp.id || '').toLowerCase();
                    const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
                    if (ph.includes('mm/dd') || ph.includes('date') || val.includes('/') ||
                        id.includes('date') || ariaLabel.includes('date') ||
                        ariaLabel.includes('depart') || ariaLabel.includes('return')) {{
                        const r = inp.getBoundingClientRect();
                        results.push({{
                            placeholder: inp.getAttribute('placeholder'),
                            ariaLabel: inp.getAttribute('aria-label'),
                            x: r.x + r.width/2, y: r.y + r.height/2,
                            w: r.width, h: r.height,
                        }});
                    }}
                }}
                return results;
            }})()
        """)
        print(f"  Found {len(date_inputs)} date inputs via deep query")
        for i, d in enumerate(date_inputs):
            print(f"    [{i}] aria=\"{d.get('ariaLabel', '')}\" placeholder=\"{d.get('placeholder', '')}\" at ({int(d['x'])}, {int(d['y'])})")

        if date_inputs:
            # Click departure date input by coordinates
            page.mouse.click(date_inputs[0]['x'], date_inputs[0]['y'])
            print(f"  Clicked departure date at ({int(date_inputs[0]['x'])}, {int(date_inputs[0]['y'])})")
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
        else:
            # Fallback: try Playwright's built-in placeholder matching
            print("  Falling back to get_by_placeholder...")
            dep_input = page.get_by_placeholder("MM/DD/YYYY").first
            dep_input.focus()
            page.wait_for_timeout(800)
            page.keyboard.press("Control+a")
            page.keyboard.press("Backspace")
            page.keyboard.type(departure_date, delay=30)
            page.wait_for_timeout(1000)
            page.keyboard.press("Tab")
            page.wait_for_timeout(800)
            page.keyboard.press("Control+a")
            page.keyboard.press("Backspace")
            page.keyboard.type(return_date, delay=30)
            page.wait_for_timeout(1000)

        # Verify form values via deep query
        form_state = page.evaluate(f"""
            (() => {{
                {DEEP_QUERY_JS}
                const inputs = deepQuerySelectorAll(document, 'input');
                const combos = [];
                const dates = [];
                for (const inp of inputs) {{
                    if (!(inp.offsetParent !== null || inp.getClientRects().length > 0)) continue;
                    if (['hidden','checkbox','radio','submit'].includes(inp.type)) continue;
                    if (inp.getAttribute('role') === 'combobox') {{
                        combos.push(inp.value);
                    }} else {{
                        const ph = (inp.getAttribute('placeholder') || '').toLowerCase();
                        const ariaLabel = (inp.getAttribute('aria-label') || '').toLowerCase();
                        if (ph.includes('mm/dd') || ariaLabel.includes('date') || ariaLabel.includes('depart') || ariaLabel.includes('return')) {{
                            dates.push(inp.value);
                        }}
                    }}
                }}
                return {{ combos, dates }};
            }})()
        """)
        print("  Form state (deep query):")
        if form_state.get('combos'):
            for i, v in enumerate(form_state['combos']):
                label = 'Origin' if i == 0 else 'Dest' if i == 1 else f'Combo[{i}]'
                print(f'    {label}  = "{v}"')
        if form_state.get('dates'):
            for i, v in enumerate(form_state['dates']):
                label = 'Depart' if i == 0 else 'Return' if i == 1 else f'Date[{i}]'
                print(f'    {label}  = "{v}"')

        # Close date picker
        page.keyboard.press("Escape")
        page.wait_for_timeout(500)

        # ── Click Search Flights ──────────────────────────────────────────
        print("STEP 6: Search flights...")

        # Strategy: deep shadow DOM query for planbook-button / auro-button with "search"
        coords = page.evaluate(f"""
            (() => {{
                {DEEP_QUERY_JS}
                // Strategy A: custom elements with "search" text
                const customBtns = deepQuerySelectorAll(document, 'auro-button, planbook-button');
                for (const aBtn of customBtns) {{
                    const txt = (aBtn.textContent || '').toLowerCase().trim();
                    if (txt.includes('search') && !txt.includes('all search')) {{
                        aBtn.scrollIntoView({{ block: 'center', behavior: 'instant' }});
                        const r = aBtn.getBoundingClientRect();
                        if (r.width > 50 && r.height > 20) {{
                            return {{ x: r.x + r.width/2, y: r.y + r.height/2, text: txt.substring(0, 50), tag: aBtn.tagName.toLowerCase() }};
                        }}
                    }}
                }}
                // Strategy B: inner button in shadow DOM of host element
                const btns = deepQuerySelectorAll(document, 'button');
                for (const btn of btns) {{
                    if (!(btn.offsetParent !== null || btn.getClientRects().length > 0)) continue;
                    const r = btn.getBoundingClientRect();
                    if (r.width < 100 || r.height < 30) continue;
                    const rootNode = btn.getRootNode();
                    if (rootNode && rootNode.host) {{
                        const hostText = (rootNode.host.textContent || '').toLowerCase().trim();
                        if (hostText.includes('search') && !hostText.includes('all search')) {{
                            btn.scrollIntoView({{ block: 'center', behavior: 'instant' }});
                            const r2 = btn.getBoundingClientRect();
                            return {{ x: r2.x + r2.width/2, y: r2.y + r2.height/2, text: hostText.substring(0, 50), tag: rootNode.host.tagName.toLowerCase() }};
                        }}
                    }}
                }}
                return null;
            }})()
        """)
        page.wait_for_timeout(500)

        if coords:
            print(f"  Found <{coords['tag']}> \"{coords['text']}\"")
            # Re-measure after scroll stabilization
            fresh = page.evaluate(f"""
                (() => {{
                    {DEEP_QUERY_JS}
                    const customBtns = deepQuerySelectorAll(document, 'auro-button, planbook-button');
                    for (const aBtn of customBtns) {{
                        const txt = (aBtn.textContent || '').toLowerCase().trim();
                        if (txt.includes('search') && !txt.includes('all search')) {{
                            const r = aBtn.getBoundingClientRect();
                            return {{ x: r.x + r.width/2, y: r.y + r.height/2 }};
                        }}
                    }}
                    return null;
                }})()
            """)
            cx = fresh['x'] if fresh else coords['x']
            cy = fresh['y'] if fresh else coords['y']
            page.mouse.click(cx, cy)
            print(f"  Clicked at ({int(cx)}, {int(cy)})")
        else:
            print("  Search button not found via deep query — trying fallback")
            page.get_by_text("Search flights", exact=False).first.evaluate("el => el.click()")

        # Wait for navigation
        start_url = page.url
        try:
            page.wait_for_url("**/search/results**", timeout=15000)
            print(f"  Navigated to: {page.url}")
        except Exception:
            print(f"  URL after wait: {page.url}")

        # If still on homepage, try JS click on host + inner shadow button
        if "search/results" not in page.url:
            print("  Retrying with JS click on shadow DOM buttons...")
            page.evaluate(f"""
                (() => {{
                    {DEEP_QUERY_JS}
                    const customBtns = deepQuerySelectorAll(document, 'planbook-button, auro-button');
                    for (const btn of customBtns) {{
                        const txt = (btn.textContent || '').toLowerCase().trim();
                        if (txt.includes('search') && !txt.includes('all search')) {{
                            btn.click();
                            if (btn.shadowRoot) {{
                                const innerBtn = btn.shadowRoot.querySelector('button');
                                if (innerBtn) {{
                                    innerBtn.click();
                                    innerBtn.dispatchEvent(new MouseEvent('click', {{ bubbles: true, cancelable: true, composed: true }}));
                                }}
                            }}
                            return;
                        }}
                    }}
                }})()
            """)
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

        dollar_matches = re.findall(r"\$\d[\d,]*", body_text)
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
                lines = [l.strip() for l in row_text.split("\n") if l.strip()]
                itinerary = " | ".join(lines[:3]) if len(lines) >= 3 else " | ".join(lines)
                price = "N/A"
                for line in lines:
                    pm = re.search(r"\$[\d,]+", line)
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
            lines = body_text.split("\n")
            i = 0
            while i < len(lines) and len(results) < max_results:
                line = lines[i].strip()
                if re.match(r"AS\s+\d{1,4}$", line):
                    itin_lines = [line]
                    j = i + 1
                    price = "N/A"
                    while j < min(i + 10, len(lines)):
                        l = lines[j].strip()
                        if not l:
                            j += 1
                            continue
                        pm = re.search(r"\$[\d,]+", l)
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
            for m in re.finditer(r"(.{0,100})(\$\d[\d,]*)", body_text, re.DOTALL):
                ctx = m.group(1).strip().split("\n")
                price = m.group(2)
                itin = " ".join(ctx[-3:]) if len(ctx) >= 3 else " ".join(ctx)
                results.append({"itinerary": itin.strip(), "price": price})
                if len(results) >= max_results:
                    break

        print(f"\nFound {len(results)} flights from '{origin}' to '{destination}':")
        print(f"  Departure: {departure_date}  Return: {return_date}\n")
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
        print(f"\nTotal flights found: {len(items)}")
