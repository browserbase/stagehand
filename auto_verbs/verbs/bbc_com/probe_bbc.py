"""Probe BBC card DOM structure"""
from playwright.sync_api import sync_playwright
import os

with sync_playwright() as pw:
    ctx = pw.chromium.launch_persistent_context(
        os.path.join(os.environ["USERPROFILE"], "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
        channel="chrome", headless=False,
        viewport={"width": 1920, "height": 1080},
        args=["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions"]
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto("https://www.bbc.com/news")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(5000)

    cards = page.locator('[data-testid="edinburgh-card"]')
    card_count = cards.count()
    print(f"Cards found: {card_count}")

    for i in range(min(5, card_count)):
        card = cards.nth(i)
        html = card.evaluate("el => el.innerHTML.substring(0, 800)")
        print(f"\n--- Card {i} ---")
        print(html)

        # Try headline locator
        try:
            h = card.locator('[data-testid="card-headline"], h2, h3').first
            txt = h.inner_text(timeout=2000)
            print(f"  HEADLINE: {txt}")
        except Exception as e:
            print(f"  HEADLINE ERROR: {e}")

        # Try link
        try:
            a = card.locator("a[href]").first
            href = a.get_attribute("href", timeout=2000)
            print(f"  URL: {href}")
        except Exception as e:
            print(f"  URL ERROR: {e}")

    ctx.close()
    print("\nDone.")
