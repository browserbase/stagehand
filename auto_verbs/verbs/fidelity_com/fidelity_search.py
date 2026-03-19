"""
Fidelity – MSFT Stock Quote
Generated: 2026-02-28T22:13:37.740Z
Pure Playwright – no AI. Uses CDP to avoid automation detection.
"""
from datetime import date, timedelta
import re, os, sys, traceback, threading
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from dataclasses import dataclass


@dataclass(frozen=True)
class FidelityQuoteRequest:
    symbol: str


@dataclass(frozen=True)
class FidelityQuote:
    symbol: str
    price: str
    day_change: str
    week52_low: str
    week52_high: str


# Fetches a stock quote from Fidelity for the given ticker symbol,
# returning price, day change, and 52-week range.
def get_fidelity_quote(
    playwright,
    request: FidelityQuoteRequest,
) -> FidelityQuote:
    SYMBOL = request.symbol
    result = {}
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default"
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport=None,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    result = {}

    def _watchdog():
        print("\n⏱️  WATCHDOG: 90s timeout — closing browser...")
        try:
            context.close()
        except Exception:
            pass
        os._exit(1)

    timer = threading.Timer(90, _watchdog)
    timer.daemon = True
    timer.start()
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
        timer.cancel()
        try:
            context.close()
        except Exception:
            pass
    return FidelityQuote(
        symbol=request.symbol,
        price=result.get("price",""),
        day_change=result.get("day_change",""),
        week52_low=result.get("week52_low",""),
        week52_high=result.get("week52_high",""),
    )
def test_get_fidelity_quote() -> None:
    from playwright.sync_api import sync_playwright
    request = FidelityQuoteRequest(symbol="MSFT")
    with sync_playwright() as playwright:
        result = get_fidelity_quote(playwright, request)
    assert result.symbol == request.symbol
    print(f"\nSymbol: {result.symbol}")
    print(f"  Price: {result.price}  Change: {result.day_change}")
    print(f"  52w Low: {result.week52_low}  52w High: {result.week52_high}")


if __name__ == "__main__":
    test_get_fidelity_quote()
