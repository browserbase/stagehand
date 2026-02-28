"""Probe BBC anchor-inner-wrapper card structure"""
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
    page.wait_for_timeout(8000)

    # Check anchor-inner-wrapper cards
    cards = page.locator('[data-testid="anchor-inner-wrapper"]')
    print(f"anchor-inner-wrapper count: {cards.count()}")

    for i in range(min(5, cards.count())):
        card = cards.nth(i)
        html = card.evaluate("el => el.innerHTML.substring(0, 1000)")
        print(f"\n=== Card {i} ===")
        print(html[:1000])

        # Try direct data-testid selectors
        for sel in ['[data-testid="card-headline"]', 'h2', 'h3', 'a[href]']:
            try:
                el = card.locator(sel).first
                if el.count() > 0:
                    txt = el.inner_text(timeout=2000)
                    print(f"  {sel}: {txt[:80]}")
                else:
                    print(f"  {sel}: not found")
            except Exception as e:
                print(f"  {sel}: ERROR {e}")

    # Also check: are card-headline elements inside anchor-inner-wrapper?
    combined = page.locator('[data-testid="anchor-inner-wrapper"] [data-testid="card-headline"]')
    print(f"\nanchor-inner-wrapper >> card-headline count: {combined.count()}")

    # Are card-headline elements somewhere else?
    # Check parent of card-headline
    for i in range(min(3, page.locator('[data-testid="card-headline"]').count())):
        parent_info = page.locator('[data-testid="card-headline"]').nth(i).evaluate(
            "el => { let p = el; let path = []; for(let j=0; j<5; j++){p = p.parentElement; if(!p) break; path.push(p.tagName + (p.dataset.testid ? '[data-testid=\"'+p.dataset.testid+'\"]' : '') + (p.className ? '.'+p.className.split(' ')[0] : ''));} return path.join(' > '); }"
        )
        headline_text = page.locator('[data-testid="card-headline"]').nth(i).inner_text(timeout=2000)
        print(f"\ncard-headline[{i}] = {headline_text[:60]}")
        print(f"  parents: {parent_info}")

    ctx.close()
    print("\nDone.")
