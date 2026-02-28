"""Probe apartments.com homepage, then search, to test if rate limit applies."""
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

    # Start from homepage (same as the JS script)
    print("Loading homepage...")
    page.goto("https://www.apartments.com")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(5000)
    print(f"URL: {page.url}")
    print(f"Title: {page.title()}")

    # Check if we got blocked
    if "Access Denied" in (page.title() or ""):
        print("\n*** BLOCKED on homepage too ***")
    else:
        print("\nHomepage loaded OK. Checking search area...")
        info = page.evaluate(r"""() => {
            const out = [];
            // Check for search input
            const inputs = document.querySelectorAll('input');
            for (const inp of inputs) {
                const vis = inp.offsetParent !== null || inp.getClientRects().length > 0;
                if (vis) {
                    out.push(`INPUT id="${inp.id}" name="${inp.name}" placeholder="${inp.placeholder}" type="${inp.type}" class="${inp.className.substring(0, 60)}"`);
                }
            }
            // Check for smart-search-input
            const ssi = document.querySelector('.smart-search-input');
            if (ssi) out.push(`\nSmart search input found: ${ssi.tagName}.${ssi.className}`);
            return out.join('\n');
        }""")
        print(info)

    ctx.close()
