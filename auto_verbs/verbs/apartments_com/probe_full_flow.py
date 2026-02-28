"""Full apartments.com search flow probe with cookie clearing."""
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

    # Clear cookies first
    ctx.clear_cookies()
    page.wait_for_timeout(1000)

    page.goto("https://www.apartments.com")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(5000)
    print(f"Homepage: {page.title()}")

    # Click smart search area
    ssi = page.locator(".smart-search-input").first
    ssi.click()
    page.wait_for_timeout(1000)

    # Find visible inputs after click
    info = page.evaluate(r"""() => {
        const inputs = document.querySelectorAll('input');
        const out = [];
        for (const inp of inputs) {
            const vis = inp.offsetParent !== null || inp.getClientRects().length > 0;
            if (vis) out.push(`INPUT id="${inp.id}" name="${inp.name}" placeholder="${inp.placeholder}" type="${inp.type}"`);
        }
        return out.join('\n');
    }""")
    print(f"\nVisible inputs:\n{info}")

    # Type Austin TX
    page.keyboard.type("Austin, TX", delay=80)
    page.wait_for_timeout(3000)

    # Check autocomplete
    ac_info = page.evaluate(r"""() => {
        const out = [];
        // Look for any visible li with Austin text
        const lis = document.querySelectorAll('li');
        for (const li of lis) {
            const vis = li.offsetParent !== null || li.getClientRects().length > 0;
            if (!vis) continue;
            const txt = li.textContent?.trim() || '';
            if (txt.length > 2 && txt.length < 200) {
                out.push(`LI id="${li.id}" class="${li.className.toString().substring(0, 60)}" text="${txt.substring(0, 100)}"`);
                if (out.length >= 10) break;
            }
        }
        // Also check role="option"
        const opts = document.querySelectorAll('[role="option"]');
        if (opts.length) out.push(`\n[role="option"] count: ${opts.length}`);
        for (const o of [...opts].slice(0, 5)) {
            out.push(`  OPTION: "${o.textContent?.trim().substring(0, 80)}"`);
        }
        return out.join('\n');
    }""")
    print(f"\nAutocomplete dropdown:\n{ac_info}")

    # Try clicking first Austin suggestion
    clicked = False
    # Try the autocomplete list
    try:
        sug = page.locator("li:has-text('Austin, TX')").first
        if sug.is_visible(timeout=2000):
            sug.click()
            clicked = True
            print("\nClicked 'Austin, TX' suggestion")
    except Exception:
        pass

    if not clicked:
        try:
            sug = page.locator("li:has-text('Austin')").first
            if sug.is_visible(timeout=2000):
                sug.click()
                clicked = True
                print("\nClicked 'Austin' suggestion")
        except Exception:
            pass

    if not clicked:
        page.keyboard.press("Enter")
        print("\nPressed Enter")

    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(8000)
    print(f"\nURL: {page.url}")
    print(f"Title: {page.title()}")

    if "Access Denied" in (page.title() or ""):
        print("\n*** BLOCKED ***")
    else:
        # Probe filter bar
        filter_info = page.evaluate(r"""() => {
            const out = [];
            // rent/price elements
            const els = document.querySelectorAll('[id*="rent" i], [id*="price" i]');
            out.push(`Rent/price elements by ID: ${els.length}`);
            for (const el of [...els].slice(0, 15)) {
                const vis = el.offsetParent !== null || el.getClientRects().length > 0;
                out.push(`  ${el.tagName} id="${el.id}" class="${el.className.toString().substring(0, 60)}" visible=${vis} text="${el.textContent?.trim().substring(0, 60)}"`);
            }
            // Cards
            const cards = document.querySelectorAll('article.placard, [data-listingid]');
            out.push(`\nListing cards: ${cards.length}`);
            
            // First card structure
            if (cards.length > 0) {
                const card = cards[0];
                out.push(`\nFirst card (${card.tagName} class="${card.className.toString().substring(0, 60)}"):`);
                for (const child of card.children) {
                    out.push(`  ${child.tagName}.${child.className.toString().substring(0, 60)}: "${child.textContent?.trim().substring(0, 100)}"`);
                }
            }
            return out.join('\n');
        }""")
        print(f"\nFilter & cards:\n{filter_info}")

    ctx.close()
