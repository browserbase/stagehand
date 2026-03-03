#!/usr/bin/env python3
"""Target coffee maker search – Playwright (Pure DOM extraction)."""

import json, re, subprocess, tempfile, shutil, os, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil

QUERY   = "coffee maker"
MAX     = 5
URL     = f"https://www.target.com/s?searchTerm={QUERY.replace(' ', '+')}"

# ── helpers ──────────────────────────────────────────────
def tmp_profile():
    tmp = tempfile.mkdtemp(prefix="target_py_")
    src = Path.home() / "AppData/Local/Google/Chrome/User Data/Default"
    for f in ("Preferences", "Local State"):
        s = src / f
        if s.exists():
            shutil.copy2(s, os.path.join(tmp, f))
    return tmp

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

def extract_products_from_dom(page, max_items=5):
    """Extract products using DOM selectors for Target product cards."""
    products = []
    
    # Target uses data-test attributes for product cards
    # Try multiple selector strategies
    card_selectors = [
        "[data-test='product-card']",
        "[data-test='@web/ProductCard']",
        "section[class*='ProductCardWrapper']",
        "div[class*='styles__StyledCol']",
        "li[class*='styles__StyledCol']",
    ]
    
    cards = []
    for sel in card_selectors:
        try:
            cards = page.locator(sel).all()
            if len(cards) >= 3:
                print(f"   Found {len(cards)} product cards using: {sel}")
                break
        except Exception:
            pass
    
    if not cards:
        # Fallback: find by product link pattern
        try:
            cards = page.locator("a[href*='/p/']").locator("xpath=ancestor::div[contains(@class, 'Col')]").all()
            print(f"   Fallback: Found {len(cards)} cards via product links")
        except Exception:
            pass
    
    for card in cards[:max_items + 5]:  # Get a few extra in case some are ads
        if len(products) >= max_items:
            break
        try:
            product = {"name": "", "price": "", "rating": "N/A"}
            
            # Get product name - look for the main link text
            name_selectors = [
                "[data-test='product-title'] a",
                "a[data-test='product-title']",
                "a[class*='ProductCardTitle']",
                "a[href*='/p/']",
            ]
            for ns in name_selectors:
                try:
                    name_el = card.locator(ns).first
                    if name_el.is_visible(timeout=500):
                        product["name"] = name_el.inner_text(timeout=1000).strip()
                        if product["name"] and len(product["name"]) > 5:
                            break
                except Exception:
                    pass
            
            # Skip if no valid name or if it's a sponsored item
            if not product["name"] or len(product["name"]) < 5:
                continue
            if "Sponsored" in product["name"]:
                continue
                
            # Get price
            price_selectors = [
                "[data-test='current-price'] span",
                "span[data-test='current-price']",
                "[class*='CurrentPrice']",
                "span[class*='price']",
            ]
            for ps in price_selectors:
                try:
                    price_el = card.locator(ps).first
                    if price_el.is_visible(timeout=500):
                        price_text = price_el.inner_text(timeout=1000).strip()
                        # Extract price pattern
                        price_match = re.search(r'\$[\d,]+\.?\d*', price_text)
                        if price_match:
                            product["price"] = price_match.group()
                            break
                except Exception:
                    pass
            
            # Get rating
            rating_selectors = [
                "[data-test='ratings'] span",
                "span[class*='RatingNumber']",
                "[class*='rating']",
            ]
            for rs in rating_selectors:
                try:
                    rating_el = card.locator(rs).first
                    rating_text = rating_el.inner_text(timeout=500).strip()
                    rating_match = re.search(r'(\d+\.?\d*)\s*out of', rating_text)
                    if rating_match:
                        product["rating"] = rating_match.group(1)
                        break
                    # Also try just a number like "4.5"
                    if re.match(r'^\d+\.?\d*$', rating_text):
                        product["rating"] = rating_text
                        break
                except Exception:
                    pass
            
            # Only add if we have at least name and price
            if product["name"] and product["price"]:
                # Check for duplicates
                if not any(p["name"] == product["name"] for p in products):
                    products.append(product)
                    
        except Exception as e:
            continue
    
    return products

# ── main ─────────────────────────────────────────────────
def main():
    with sync_playwright() as pw:
        port = get_free_port()
        profile_dir = get_temp_profile_dir("target_com")
        chrome_proc = launch_chrome(profile_dir, port)
        try:
            ws_url = wait_for_cdp_ws(port)
            browser = pw.chromium.connect_over_cdp(ws_url)
            ctx = browser.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            
            print(f"Loading: {URL}")
            page.goto(URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)
            dismiss(page)

            # Scroll to load more products
            for _ in range(3):
                page.evaluate("window.scrollBy(0, 800)")
                page.wait_for_timeout(500)
            page.evaluate("window.scrollTo(0, 0)")
            page.wait_for_timeout(1000)

            # Try DOM-based extraction first
            print("Extracting products via DOM selectors...")
            products = extract_products_from_dom(page, MAX)
            
            # Fallback to body text if DOM extraction fails
            if len(products) < MAX:
                print(f"   DOM extraction got {len(products)}, trying body text fallback...")
                products = extract_from_body_text(page, MAX, products)

            print()
            print("=" * 60)
            print(f"  Target – Top {len(products)} coffee makers")
            print("=" * 60)
            for idx, p in enumerate(products, 1):
                print(f"  {idx}. {p['name'][:80]}{'...' if len(p['name']) > 80 else ''}")
                print(f"     Price:  {p['price']}")
                print(f"     Rating: {p['rating']}")
                print()

            if not products:
                print("  ⚠ No products extracted.")

            try:
                browser.close()
            except Exception:
                pass
        finally:
            chrome_proc.terminate()
            shutil.rmtree(profile_dir, ignore_errors=True)
    
    return products


def extract_from_body_text(page, max_items, existing_products):
    """Fallback extraction from body text with improved filtering."""
    products = list(existing_products)
    text = page.inner_text("body")
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    
    # Skip words that are definitely not product names
    skip_patterns = [
        r'^(Highly rated|Sponsored|Save\s|Add to cart|Shop|Pickup|Delivery|Shipping)$',
        r'^\d+k?\+?\s*(bought|sold|reviews?)',
        r'^(Shop all|See more|View all|Filter|Sort)',
        r'^Shipping dates',
        r'^\d+\s*reviews?$',
    ]
    
    i = 0
    while i < len(lines) and len(products) < max_items:
        line = lines[i]
        price_match = re.match(r'^\$(\d+(?:\.\d{2})?)', line)
        if price_match and i > 0:
            # Look backward for a valid product name
            name = None
            for back in range(i - 1, max(i - 8, -1), -1):
                candidate = lines[back]
                # Must be long enough to be a product name
                if len(candidate) < 20:
                    continue
                # Skip promotional text
                if any(re.match(p, candidate, re.IGNORECASE) for p in skip_patterns):
                    continue
                if candidate.startswith('$'):
                    continue
                if re.match(r'^\d+(\.\d)?\s*out of', candidate):
                    continue
                # Should look like a product name (has brand-like words)
                if re.search(r'(Keurig|Hamilton|Braun|Mr\.\s*Coffee|Cuisinart|BLACK\+DECKER|Ninja|Breville|OXO|Bodum|Chemex|Nespresso|De\'?Longhi)', candidate, re.IGNORECASE):
                    name = candidate
                    break
                # Or has product-like words
                if re.search(r'(Coffee|Maker|Brewer|Espresso|Drip|Cup|Pod|Carafe)', candidate, re.IGNORECASE):
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
    
    return products


if __name__ == "__main__":
    main()
