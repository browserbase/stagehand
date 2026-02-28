"""Probe BBC page - check what's actually loading"""
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
    page.wait_for_timeout(8000)  # longer wait

    print(f"URL: {page.url}")
    print(f"Title: {page.title()}")

    # Check for various card selectors
    for sel in [
        '[data-testid="edinburgh-card"]',
        '[data-testid="anchor-inner-wrapper"]',
        'article',
        '[class*="promo"]',
        'h2',
        'h3',
        '[data-testid="card-headline"]',
        'a[data-testid]',
    ]:
        count = page.locator(sel).count()
        print(f"  {sel}: {count}")

    # Get first 2000 chars of visible text
    body_text = page.evaluate("document.body.innerText.substring(0, 2000)")
    print(f"\n--- Body text (first 2000 chars) ---")
    print(body_text)

    ctx.close()
    print("\nDone.")
