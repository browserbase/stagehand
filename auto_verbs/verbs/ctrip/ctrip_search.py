"""
Auto-generated Playwright script (Python)
Ctrip – Train Ticket Search
From: 上海  To: 福州
Departure: 2026-03-13  (One-way, 1 adult)

Generated on: 2026-03-10T00:05:22.211Z
Recorded 3 browser interactions

Uses Playwright's native locator API with CDP connection to real Chrome.
Navigates directly to the search results URL (Ctrip's React form is hard
to automate via normal Playwright typing).
"""

import re
import os, sys, shutil
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def compute_departure():
    today = date.today()
    departure = today + timedelta(days=4)
    return departure


def run(
    playwright: Playwright,
    from_station: str = "上海",
    to_station: str = "福州",
    max_results: int = 5,
) -> list:
    departure = compute_departure()
    departure_str = departure.strftime("%Y-%m-%d")

    print(f"  From: {from_station}  To: {to_station}")
    print(f"  Departure: {departure_str}  (One-way, 1 adult)\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("ctrip")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate directly to search results ──────────────────────────
        from urllib.parse import quote
        search_url = (
            f"https://trains.ctrip.com/webapp/train/list"
            f"?ticketType=0"
            f"&dStation={quote(from_station)}"
            f"&aStation={quote(to_station)}"
            f"&dDate={departure_str}"
            f"&rDate=&trainsNo=&from=trains_mainpage"
        )
        print(f"Loading search results: {search_url}")
        page.goto(search_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(8000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups / cookie banners ───────────────────────────────
        for selector in [
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
            "button:has-text('知道了')",
            "button:has-text('关闭')",
            ".close-btn",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Extract train results ─────────────────────────────────────────
        print(f"Extracting up to {max_results} trains...")

        # Try extracting from train list items
        train_items = page.locator(
            '.train-list .list-item, '
            '[class*="train-list"] [class*="item"], '
            '[class*="trainItem"], '
            '[class*="list-item"]'
        )
        count = train_items.count()
        print(f"  Found {count} train items")

        for i in range(min(count, max_results)):
            item = train_items.nth(i)
            try:
                text = item.inner_text(timeout=3000)
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                dep_time = arr_time = duration = price = train_no = "N/A"
                for line in lines:
                    # Train number (G/D/K/Z/T followed by digits)
                    tn_m = re.search(r"([GDKZT]\d+)", line)
                    if tn_m and train_no == "N/A":
                        train_no = tn_m.group(1)
                        continue  # skip this line for other extraction
                    # Times HH:MM
                    tm = re.findall(r"\d{2}:\d{2}", line)
                    if len(tm) >= 2 and dep_time == "N/A":
                        dep_time, arr_time = tm[0], tm[1]
                        continue
                    elif len(tm) == 1 and dep_time == "N/A":
                        dep_time = tm[0]
                        continue
                    elif len(tm) == 1 and dep_time != "N/A" and arr_time == "N/A":
                        arr_time = tm[0]
                        continue
                    # Duration
                    dur_m = re.search(r"(\d+[时h])?\s*(\d+[分m])", line)
                    if dur_m and duration == "N/A":
                        duration = dur_m.group(0).strip()
                        continue
                    # Price — may have ¥/￥ prefix or be a plain number
                    price_m = re.search(r"[¥￥](\d+\.?\d*)", line)
                    if price_m and price == "N/A":
                        price = "¥" + price_m.group(1)
                    elif price == "N/A" and ":" not in line:
                        # Look for standalone numbers that look like prices
                        plain_m = re.search(r"(\d{2,}(?:\.\d+)?)", line)
                        if plain_m:
                            val = plain_m.group(1)
                            price = "¥" + val
                results.append({
                    "train_number": train_no,
                    "departure_time": dep_time,
                    "arrival_time": arr_time,
                    "duration": duration,
                    "price": price,
                })
            except Exception:
                continue

        # Fallback: parse entire page text
        if not results:
            print("  Item extraction failed, trying page text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            lines = body_text.split("\n")
            for line in lines:
                if len(results) >= max_results:
                    break
                tn_m = re.search(r"([GDKZT]\d+)", line)
                times = re.findall(r"\d{2}:\d{2}", line)
                price_m = re.search(r"[¥￥](\d+\.?\d*)", line)
                if tn_m and len(times) >= 2 and price_m:
                    results.append({
                        "train_number": tn_m.group(1),
                        "departure_time": times[0],
                        "arrival_time": times[1],
                        "duration": "N/A",
                        "price": "¥" + price_m.group(1),
                    })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\nFound {len(results)} trains from '{from_station}' to '{to_station}':")
        print(f"  Departure: {departure_str}  (One-way, 1 adult)\n")
        for i, train in enumerate(results, 1):
            print(f"  {i}. {train['train_number']}  Dep: {train['departure_time']}  Arr: {train['arrival_time']}  Duration: {train['duration']}  Price: {train['price']}")

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
        print(f"\nTotal trains found: {len(items)}")
