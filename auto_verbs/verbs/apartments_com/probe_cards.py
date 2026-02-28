"""Probe apartments.com listing card DOM to discover correct selectors for price/beds."""
import os
from playwright.sync_api import sync_playwright

def main():
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    with sync_playwright() as pw:
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir, channel="chrome", headless=False,
            viewport={"width": 1920, "height": 1080},
            args=["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions"],
        )
        page = ctx.pages[0] if ctx.pages else ctx.new_page()

        # Go directly to a results page with price filter
        page.goto("https://www.apartments.com/austin-tx/1000-to-2000/")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"URL: {page.url}")
        print(f"Title: {page.title()}")

        # Inspect first 3 article.placard cards
        cards = page.locator("article.placard")
        count = cards.count()
        print(f"\nFound {count} article.placard cards")

        for i in range(min(3, count)):
            card = cards.nth(i)
            print(f"\n{'='*60}")
            print(f"CARD {i}:")
            # Get the outer HTML (first 2000 chars)
            html = card.evaluate("el => el.outerHTML")
            print(html[:2000])
            print(f"\n--- Inner text ---")
            print(card.inner_text()[:500])

            # Try various selectors for price
            print(f"\n--- Price selectors ---")
            for sel in [
                '[class*="property-pricing"]', 'p.property-pricing',
                'span[class*="price"]', 'div[class*="pricing"]',
                '[class*="rent"]', '[class*="Price"]',
                'p.price-range', '.price-range',
                'span.property-rents', 'div.price-range',
            ]:
                try:
                    el = card.locator(sel).first
                    if el.count() > 0:
                        txt = el.inner_text(timeout=1000).strip()
                        print(f"  {sel} → \"{txt}\"")
                except Exception:
                    pass

            # Try various selectors for beds/baths
            print(f"\n--- Beds selectors ---")
            for sel in [
                '[class*="property-beds"]', 'p.property-beds',
                'span[class*="bed"]', '[class*="beds"]',
                '[class*="Bed"]', '[class*="unit-type"]',
            ]:
                try:
                    el = card.locator(sel).first
                    if el.count() > 0:
                        txt = el.inner_text(timeout=1000).strip()
                        print(f"  {sel} → \"{txt}\"")
                except Exception:
                    pass

        # Also dump all unique class names inside first card
        if count > 0:
            print(f"\n{'='*60}")
            print("ALL CLASS NAMES in first card:")
            classes = cards.nth(0).evaluate("""el => {
                const all = el.querySelectorAll('*');
                const classSet = new Set();
                all.forEach(e => {
                    if (e.className && typeof e.className === 'string') {
                        e.className.split(/\\s+/).forEach(c => { if (c) classSet.add(c); });
                    }
                });
                return Array.from(classSet).sort();
            }""")
            print(", ".join(classes))

        ctx.close()
        print("\nDone!")

if __name__ == "__main__":
    main()
