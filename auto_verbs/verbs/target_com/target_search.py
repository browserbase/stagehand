#!/usr/bin/env python3
"""Target coffee maker search – Playwright (auto-generated)."""

import json, re, subprocess, tempfile, shutil, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY   = "coffee maker"
MAX     = 5
URL     = f"https://www.target.com/s?searchTerm={QUERY.replace(' ', '+')}"

REFERENCE = json.loads(r"""
[
  {
    "name": "Ninja DualBrew Hot & Iced Coffee Maker -CFP101: 12-Cup, Custom Brew Strength, Removable Reservoir, Glass Carafe",
    "price": "",
    "rating": "N/A"
  },
  {
    "name": "Ninja Single-Serve Pods & Grounds Coffee Maker with Integrated Milk Frother",
    "price": "",
    "rating": "N/A"
  },
  {
    "name": "Fellow Aiden Precision Coffee Maker Matte Black",
    "price": "",
    "rating": "N/A"
  },
  {
    "name": "Mr. Coffee 12-Cup Switch Coffee Maker Black: Electric Drip Coffee Machine, 60 oz Capacity, Dishwasher-Safe Parts",
    "price": "",
    "rating": "N/A"
  },
  {
    "name": "Hamilton Beach 12 Cup Programmable Coffee Maker Black 46290: Drip Coffee Machine, Nonstick Hot Plate, Brew Pause",
    "price": "",
    "rating": "N/A"
  }
]
""")

def dismiss(page):
    for sel in [
        "#onetrust-accept-btn-handler",
        "button.onetrust-close-btn-handler",
        "button:has-text('Accept All')",
        "button:has-text('Accept')",
        "button:has-text('Got it')",
        "button:has-text('OK')",
        "button:has-text('Dismiss')",
        "button:has-text('Close')",
    ]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=600):
                loc.evaluate("el => el.click()")
                time.sleep(0.3)
        except Exception:
            pass

# ── main ─────────────────────────────────────────────────
def main():
    with sync_playwright() as pw:
        port = get_free_port()
        profile_dir = get_temp_profile_dir("target_com")
        chrome_proc = launch_chrome(profile_dir, port)
        ws_url = wait_for_cdp_ws(port)
        browser = pw.chromium.connect_over_cdp(ws_url)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.new_page()
        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)
            dismiss(page)

            # Try to apply rating filter via AI-like approach: click the rating filter
            try:
                rating_filter = page.locator("text=/4 stars? & up|4\\+|Guest [Rr]ating 4/i").first
                if rating_filter.is_visible(timeout=3000):
                    rating_filter.evaluate("el => el.click()")
                    page.wait_for_timeout(2000)
            except Exception:
                pass

            # Extract from body text
            text = page.inner_text("body")
            lines = [l.strip() for l in text.splitlines() if l.strip()]

            products = []
            i = 0
            while i < len(lines) and len(products) < MAX:
                line = lines[i]
                # Target product prices like "$XX.XX"
                price_match = re.match(r'^\$(\d+(?:\.\d{2})?)', line)
                if price_match and i > 0:
                    name = None
                    for back in range(i - 1, max(i - 5, -1), -1):
                        candidate = lines[back]
                        if (len(candidate) > 10
                            and not candidate.startswith('$')
                            and not re.match(r'^\d+(\.\d)?\s*out of', candidate)
                            and 'Sponsored' not in candidate
                            and not candidate.startswith('Save ')
                            and candidate not in ('Add to cart', 'Shop', 'Pickup', 'Delivery', 'Shipping')):
                            name = candidate
                            break
                    if not name:
                        i += 1
                        continue

                    price_str = "$" + price_match.group(1)

                    rating = "N/A"
                    for near in range(max(i - 3, 0), min(i + 5, len(lines))):
                        rm = re.search(r'(\d+\.\d)\s*out of\s*5', lines[near])
                        if rm:
                            rating = rm.group(1)
                            break

                    if not any(p["name"] == name for p in products):
                        products.append({
                            "name": name,
                            "price": price_str,
                            "rating": rating,
                        })
                i += 1

            print()
            print("=" * 60)
            print(f"  Target – Top {MAX} coffee makers")
            print("=" * 60)
            for idx, p in enumerate(products, 1):
                print(f"  {idx}. {p['name']}")
                print(f"     Price:  {p['price']}")
                print(f"     Rating: {p['rating']}")
                print()

            if not products:
                print("  ⚠ No products extracted from page text.")
                print("  Reference results from JS run:")
                for idx, r in enumerate(REFERENCE, 1):
                    print(f"  {idx}. {r.get('name','?')} – {r.get('price','?')} – Rating: {r.get('rating','?')}")

        finally:
            try:
                browser.close()
            except Exception:
                pass
            chrome_proc.terminate()
            shutil.rmtree(profile_dir, ignore_errors=True)

if __name__ == "__main__":
    main()
