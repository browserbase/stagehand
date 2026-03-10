"""
Fidelity – MSFT Stock Quote
Generated: 2026-02-28T22:13:37.740Z
Pure Playwright – no AI. Uses CDP to avoid automation detection.
"""
import re, os, sys, traceback, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

SYMBOL = "MSFT"

def run(playwright: Playwright) -> dict:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("fidelity_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {}
    try:
        print("STEP 1: Navigate to Fidelity quote page...")
        page.goto(f"https://eresearch.fidelity.com/eresearch/evaluate/snapshot.jhtml?symbols={SYMBOL}",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        for sel in ["button:has-text('Accept')", "button:has-text('OK')", "button:has-text('Close')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        print("STEP 2: Extract stock data...")
        text = page.inner_text("body")

        # Price – anchor on 'Market insights' which precedes the quote block
        anchor = text.find("Market insights")
        if anchor == -1:
            anchor = 0
        quote_area = text[anchor:anchor + 600]
        price_match = re.search(r'\$(\d{1,4}\.\d{2})(?!%)', quote_area)
        result["price"] = "$" + price_match.group(1) if price_match else "N/A"

        # Day change – right after the price in the same section
        if price_match:
            after_price = quote_area[price_match.end():]
            change_match = re.search(r'([+-]?\d+\.\d{2})\s*\(([+-]?\d+\.\d{2})%\)', after_price)
        else:
            change_match = None
        if change_match:
            result["day_change"] = f"{change_match.group(1)} ({change_match.group(2)}%)"
        else:
            result["day_change"] = "N/A"

        # 52-week range – Fidelity shows "52-week range" then low and high
        # Skip $XX.XX% patterns (the progress-bar percentage)
        range_pos = text.find("52-week range")
        if range_pos != -1:
            range_text = text[range_pos:range_pos + 300]
            prices = re.findall(r'\$(\d{1,4}\.\d{2})(?!%)', range_text)
            if len(prices) >= 2:
                result["week52_low"]  = "$" + prices[0]
                result["week52_high"] = "$" + prices[1]
            else:
                result["week52_high"] = "N/A"
                result["week52_low"]  = "N/A"
        else:
            result["week52_high"] = "N/A"
            result["week52_low"]  = "N/A"

        if not result.get("price") or result["price"] == "N/A":
            print("   Could not extract price from page.")

        print(f"\nDONE – MSFT Stock Quote:")
        print(f"  Price:       {result.get('price', 'N/A')}")
        print(f"  Day Change:  {result.get('day_change', 'N/A')}")
        print(f"  52-Wk High:  {result.get('week52_high', 'N/A')}")
        print(f"  52-Wk Low:   {result.get('week52_low', 'N/A')}")

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
    return result

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
