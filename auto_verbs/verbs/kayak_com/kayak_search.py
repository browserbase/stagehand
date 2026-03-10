"""
Kayak – Flights Boston to Miami
Generated: 2026-02-28T15:40:42.281Z
Pure Playwright – no AI.
"""
import re, os, traceback
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("kayak_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    flights = []
    try:
        depart = date.today() + timedelta(days=60)
        ret = depart + timedelta(days=4)
        d_str = depart.strftime("%Y-%m-%d")
        r_str = ret.strftime("%Y-%m-%d")

        print(f"STEP 1: Navigate to Kayak (BOS→MIA, {d_str} to {r_str})...")
        url = f"https://www.kayak.com/flights/BOS-MIA/{d_str}/{r_str}?sort=price_a"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(10000)

        for sel in ["button:has-text('Accept')", "button:has-text('OK')", ".dCLk-close"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(6):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract flight data...")

        # Try structured result card selectors first
        card_selectors = [
            "[class*='resultInner']", "[class*='nrc6']",
            "[class*='result-item']", "div[class*='flight']",
        ]
        for card_sel in card_selectors:
            cards = page.locator(card_sel)
            count = cards.count()
            if count == 0:
                continue
            for i in range(min(count, 15)):
                if len(flights) >= 5:
                    break
                try:
                    card = cards.nth(i)
                    txt = card.inner_text(timeout=2000)
                    lines_c = [l.strip() for l in txt.split("\n") if l.strip()]
                    full = " ".join(lines_c)
                    pm = re.search(r"\$(\d[\d,]*)", full)
                    if not pm:
                        continue
                    price = f"${pm.group(1)}"
                    airline = ""
                    itinerary = ""
                    for ln in lines_c:
                        if re.search(r"AM|PM|am|pm|\d{1,2}:\d{2}", ln) and len(ln) < 120:
                            itinerary = (itinerary + "\n" + ln).strip() if itinerary else ln
                        elif len(ln) > 3 and len(ln) < 50 and not re.search(r"\$|filter|sort|stop|nonstop|layover", ln, re.IGNORECASE) and not re.search(r"\d+h|\d+m", ln):
                            if not airline:
                                airline = ln
                    flights.append({"airline": airline or "N/A", "itinerary": itinerary or "N/A", "price": price})
                except Exception:
                    pass
            if flights:
                break

        if not flights:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\n") if l.strip()]
            for i, line in enumerate(lines):
                if "$" in line and re.search(r"\$\d+", line):
                    m = re.search(r"\$([\d,]+)", line)
                    if m:
                        price = f"${m.group(1)}"
                        airline = ""
                        itinerary = ""
                        for j in range(max(0, i-5), i):
                            nl = lines[j]
                            if re.search(r"AM|PM|\d{1,2}:\d{2}", nl):
                                itinerary = nl[:100]
                            elif len(nl) > 3 and len(nl) < 40 and not re.search(r"\$|filter|sort", nl, re.IGNORECASE):
                                airline = nl
                        flights.append({"airline": airline or "N/A", "itinerary": itinerary or "N/A", "price": price})
                if len(flights) >= 5:
                    break

        print(f"\nDONE – Top {len(flights)} Cheapest Flights:")
        for i, f in enumerate(flights, 1):
            print(f"  {i}. {f.get('airline', 'N/A')} | {f.get('itinerary', 'N/A')} | {f.get('price', 'N/A')}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return flights

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
