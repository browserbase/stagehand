"""Test apartments.com with cookie clearing and longer waits to bypass rate limit."""
import os
import time
from playwright.sync_api import sync_playwright

with sync_playwright() as p:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    ctx = p.chromium.launch_persistent_context(
        user_data_dir, channel="chrome", headless=False,
        viewport={"width": 1920, "height": 1080},
        args=["--disable-blink-features=AutomationControlled"],
    )
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    # Clear cookies for apartments.com
    print("Clearing apartments.com cookies...")
    ctx.clear_cookies()
    page.wait_for_timeout(2000)

    # Navigate to homepage with human-like delay
    print("Loading homepage...")
    page.goto("https://www.apartments.com")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(8000)
    title = page.title()
    print(f"Title: {title}")
    print(f"URL: {page.url}")

    if "Access Denied" in title:
        print("\n*** Still blocked even after clearing cookies ***")
        # Try checking the body for more info
        body = page.evaluate("document.body?.innerText?.substring(0, 500)")
        print(f"Body: {body}")
    else:
        print("\n*** Homepage loaded OK! ***")
        # Quick check: is smart search input visible?
        ssi = page.locator(".smart-search-input")
        print(f"Smart search input count: {ssi.count()}")

    ctx.close()
