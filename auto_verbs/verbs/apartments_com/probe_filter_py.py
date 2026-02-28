"""Probe the apartments.com search results page for price filter and card selectors."""
import os
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

    # Navigate directly to a known working results URL
    page.goto("https://www.apartments.com/austin-tx/?ss=Austin%2C+TX")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(8000)
    print(f"URL: {page.url}")
    print(f"Title: {page.title()}\n")

    # 1. Look for price/rent filter elements
    info = page.evaluate(r"""() => {
        const out = [];
        
        // Search for elements with rent/price in id, class, or aria
        out.push("=== Elements with rent/price in id/class ===");
        const allEls = document.querySelectorAll('[id*="rent" i], [id*="price" i], [class*="rent" i], [class*="price" i]');
        const seen = new Set();
        for (const el of [...allEls].slice(0, 30)) {
            const key = el.tagName + '#' + el.id + '.' + el.className.toString().substring(0, 80);
            if (seen.has(key)) continue;
            seen.add(key);
            const vis = el.offsetParent !== null || el.getClientRects().length > 0;
            out.push(`  ${el.tagName} id="${el.id}" class="${el.className.toString().substring(0, 80)}" visible=${vis} text="${el.textContent?.trim().substring(0, 60)}"`);
        }

        // Look for filter bar / toolbar links
        out.push("\n=== Filter bar links/buttons ===");
        const filterEls = document.querySelectorAll('.filterBarButton, .filter-button, [data-filter], .filterBar a, .filterBar button, .toolbar a, .toolbar button, [class*="filter"] a, [class*="filter"] button');
        for (const el of [...filterEls].slice(0, 20)) {
            const vis = el.offsetParent !== null || el.getClientRects().length > 0;
            out.push(`  ${el.tagName} id="${el.id}" class="${el.className.toString().substring(0, 80)}" visible=${vis} text="${el.textContent?.trim().substring(0, 60)}"`);
        }

        // Look for a link/button with text containing "Price" or "Rent"
        out.push("\n=== Buttons/links with Price/Rent text ===");
        const btns = document.querySelectorAll('button, a, [role="button"]');
        for (const el of btns) {
            const txt = el.textContent?.trim() || '';
            if (/price|rent/i.test(txt) && txt.length < 60) {
                const vis = el.offsetParent !== null || el.getClientRects().length > 0;
                out.push(`  ${el.tagName} id="${el.id}" class="${el.className.toString().substring(0, 80)}" visible=${vis} text="${txt.substring(0, 60)}"`);
            }
        }

        // Look for the first few article.placard or data-listingid cards
        out.push("\n=== Listing cards ===");
        const cards = document.querySelectorAll('article.placard, [data-listingid]');
        out.push(`Found ${cards.length} cards`);
        for (const card of [...cards].slice(0, 2)) {
            out.push(`  Card: ${card.tagName} id="${card.id}" class="${card.className.toString().substring(0, 80)}"`);
            // direct children
            for (const child of card.children) {
                out.push(`    ${child.tagName}.${child.className.toString().substring(0, 60)}: text="${child.textContent?.trim().substring(0, 100)}"`);
            }
        }

        return out.join('\n');
    }""")
    print(info)

    ctx.close()
