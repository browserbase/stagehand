#!/usr/bin/env python3
"""
Walmart wireless earbuds search – Playwright

Uses Playwright persistent context with real Chrome Default profile.
IMPORTANT: Close ALL Chrome windows before running!
"""

import json
import re
import os
import time
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout


QUERY = "wireless earbuds"
SORT = "best_seller"
MAX = 5
URL = f"https://www.walmart.com/search?q={QUERY.replace(' ', '+')}&sort={SORT}"


def get_chrome_default_profile() -> str:
    """Get the Chrome Default profile path (not User Data, but Default subfolder)."""
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    if os.path.isdir(user_data_dir):
        return user_data_dir
    raise FileNotFoundError("Could not find Chrome Default profile")


def dismiss_popups(page):
    """Dismiss cookie banners and popups."""
    for sel in [
        "#onetrust-accept-btn-handler",
        "button.onetrust-close-btn-handler",
        "button:has-text('Accept All')",
        "button:has-text('Accept')",
        "button:has-text('Got it')",
        "button:has-text('OK')",
        "button:has-text('Dismiss')",
        "[aria-label='Close']",
    ]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=600):
                loc.evaluate("el => el.click()")
                time.sleep(0.3)
        except Exception:
            pass


def extract_products(page, max_products=5):
    """Extract product info from Walmart search results."""
    products = []
    
    # Try to find product cards using data attributes
    card_selectors = [
        "[data-testid='list-view']",
        "[data-item-id]",
        "[class*='product-tile']",
        "[class*='ProductCard']",
        "[class*='search-result-gridview-item']",
    ]
    
    cards = None
    for sel in card_selectors:
        found = page.locator(sel)
        if found.count() > 0:
            cards = found
            break
    
    if cards and cards.count() > 0:
        # DOM-based extraction
        for i in range(min(cards.count(), max_products * 2)):
            if len(products) >= max_products:
                break
            try:
                card = cards.nth(i)
                text = card.inner_text(timeout=2000)
                
                # Skip sponsored items
                if "Sponsored" in text[:50]:
                    continue
                
                lines = [l.strip() for l in text.split("\n") if l.strip()]
                
                # Find price
                price = None
                for line in lines:
                    m = re.search(r'(?:Now\s+)?\$(\d+(?:\.\d{2})?)', line)
                    if m:
                        price = "$" + m.group(1)
                        break
                
                if not price:
                    continue
                
                # Find product name (usually the longest meaningful line)
                name = None
                for line in lines:
                    # Skip promotional/metadata lines
                    if re.match(r'^\d+\+?\s*bought', line, re.IGNORECASE):
                        continue
                    if re.match(r'^(current price|was|now)\s', line, re.IGNORECASE):
                        continue
                    if (len(line) > 20
                        and not line.startswith('$')
                        and not re.match(r'^\d+(\.\d)?\s*out of', line)
                        and 'Sponsored' not in line
                        and 'Save ' not in line
                        and 'Options from' not in line
                        and 'Best seller' not in line
                        and 'Free shipping' not in line.lower()
                        and not line.startswith('+')):
                        name = line
                        break
                
                if not name:
                    continue
                
                # Find rating
                rating = "N/A"
                for line in lines:
                    rm = re.search(r'(\d+\.\d)\s*out of\s*5', line)
                    if rm:
                        rating = rm.group(1)
                        break
                
                # Avoid duplicates
                if not any(p["name"] == name for p in products):
                    products.append({
                        "name": name[:100] + "..." if len(name) > 100 else name,
                        "price": price,
                        "rating": rating,
                    })
            except Exception:
                continue
    
    # Fallback: body text extraction if DOM approach didn't work well
    if len(products) < max_products:
        text = page.inner_text("body")
        lines = [l.strip() for l in text.splitlines() if l.strip()]
        
        i = 0
        while i < len(lines) and len(products) < max_products:
            line = lines[i]
            price_match = re.match(r'^(?:Now\s+)?\$(\d+(?:\.\d{2})?)', line)
            if price_match and i > 0:
                # Look backwards for product name
                name = None
                for back in range(i - 1, max(i - 5, -1), -1):
                    candidate = lines[back]
                    if (len(candidate) > 15
                        and not candidate.startswith('$')
                        and not re.match(r'^\d+(\.\d)?\s*out of', candidate)
                        and 'Sponsored' not in candidate
                        and not candidate.startswith('Save ')
                        and not candidate.startswith('Options ')
                        and not candidate.startswith('Best seller')):
                        name = candidate
                        break
                
                if name:
                    price_str = "$" + price_match.group(1)
                    
                    # Look nearby for rating
                    rating = "N/A"
                    for near in range(max(i - 3, 0), min(i + 5, len(lines))):
                        rm = re.search(r'(\d+\.\d)\s*out of\s*5', lines[near])
                        if rm:
                            rating = rm.group(1)
                            break
                    
                    # Avoid duplicates
                    if not any(p["name"] == name for p in products):
                        products.append({
                            "name": name[:100] + "..." if len(name) > 100 else name,
                            "price": price_str,
                            "rating": rating,
                        })
            i += 1
    
    return products


def main():
    user_data_dir = get_chrome_default_profile()
    print(f"Using Chrome profile: {user_data_dir}")
    print("NOTE: Close ALL Chrome windows before running!\n")
    
    with sync_playwright() as pw:
        context = pw.chromium.launch_persistent_context(
            user_data_dir,
            channel="chrome",
            headless=False,
            viewport={"width": 1280, "height": 900},
            args=[
                "--disable-blink-features=AutomationControlled",
                "--disable-infobars",
                "--disable-extensions",
                "--start-maximized",
            ],
        )
        page = context.pages[0] if context.pages else context.new_page()
        
        try:
            print(f"Loading: {URL}")
            page.goto(URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)
            dismiss_popups(page)
            page.wait_for_timeout(2000)
            
            # Scroll to load more products
            for _ in range(3):
                page.evaluate("window.scrollBy(0, 500)")
                page.wait_for_timeout(500)
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(1000)
            
            products = extract_products(page, MAX)
            
            print()
            print("=" * 60)
            print(f"  Walmart – Top {MAX} wireless earbuds (Best Seller)")
            print("=" * 60)
            for idx, p in enumerate(products, 1):
                print(f"  {idx}. {p['name']}")
                print(f"     Price:  {p['price']}")
                print(f"     Rating: {p['rating']}")
                print()
            
            if not products:
                print("  No products extracted from page text.")
                print(f"  Current URL: {page.url}")
        
        finally:
            try:
                context.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
