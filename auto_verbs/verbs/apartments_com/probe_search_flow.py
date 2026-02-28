"""Probe the full apartments.com homepage search flow:
   1. Load homepage
   2. Click the smart-search-input area  
   3. Find the actual input and type "Austin, TX"
   4. Inspect the autocomplete dropdown
   5. Click first suggestion and see the result page filter bar
"""
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

    page.goto("https://www.apartments.com")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(5000)
    print(f"Homepage: {page.title()}")

    # Step 1: Click the smart search area
    ssi = page.locator(".smart-search-input").first
    ssi.click()
    page.wait_for_timeout(1000)

    # Step 2: Find visible inputs after click
    info = page.evaluate(r"""() => {
        const out = [];
        const inputs = document.querySelectorAll('input');
        for (const inp of inputs) {
            const vis = inp.offsetParent !== null || inp.getClientRects().length > 0;
            if (vis) {
                out.push(`INPUT id="${inp.id}" name="${inp.name}" placeholder="${inp.placeholder}" type="${inp.type}" class="${inp.className.substring(0, 80)}"`);
            }
        }
        return out.join('\n');
    }""")
    print(f"\nVisible inputs after click:\n{info}")

    # Step 3: Type "Austin, TX"
    page.keyboard.type("Austin, TX", delay=80)
    page.wait_for_timeout(3000)

    # Step 4: Check for autocomplete dropdown
    ac_info = page.evaluate(r"""() => {
        const out = [];
        // Look for autocomplete list items
        const candidates = document.querySelectorAll('li, [role="option"], [class*="autocomp"], [class*="suggest"]');
        let found = 0;
        for (const el of candidates) {
            const vis = el.offsetParent !== null || el.getClientRects().length > 0;
            if (!vis) continue;
            const txt = el.textContent?.trim().substring(0, 100) || '';
            if (txt.length > 2 && txt.length < 200) {
                out.push(`  ${el.tagName} id="${el.id}" class="${el.className.toString().substring(0, 60)}" text="${txt}"`);
                found++;
                if (found >= 10) break;
            }
        }
        if (!found) out.push("  No visible autocomplete items found");
        
        // Also look for UL with autocomplete
        const lists = document.querySelectorAll('ul[class*="auto"], ul[class*="suggest"], ul[role="listbox"], [class*="autocomplete"]');
        out.push(`\nAutocomplete containers: ${lists.length}`);
        for (const list of lists) {
            const vis = list.offsetParent !== null || list.getClientRects().length > 0;
            out.push(`  ${list.tagName} class="${list.className.toString().substring(0, 80)}" visible=${vis} children=${list.children.length}`);
        }
        return out.join('\n');
    }""")
    print(f"\nAutocomplete items:\n{ac_info}")

    # Step 5: Try clicking first autocomplete suggestion
    clicked = False
    for sel in [".autocompleteList li", "[role='option']", "[role='listbox'] li", "li[class*='auto']"]:
        try:
            sug = page.locator(sel).first
            if sug.is_visible(timeout=2000):
                txt = sug.inner_text(timeout=1000)
                sug.click()
                clicked = True
                print(f"\nClicked suggestion: '{txt}'")
                break
        except Exception:
            pass

    if not clicked:
        # Try a broader search
        vis_lis = page.evaluate(r"""() => {
            const lis = document.querySelectorAll('li');
            const out = [];
            for (const li of lis) {
                const vis = li.offsetParent !== null || li.getClientRects().length > 0;
                if (!vis) continue;
                const txt = li.textContent?.trim() || '';
                if (txt.toLowerCase().includes('austin')) {
                    out.push({tag: li.tagName, id: li.id, cls: li.className.toString().substring(0, 60), text: txt.substring(0, 80)});
                }
            }
            return out;
        }""")
        print(f"\nLIs containing 'austin': {vis_lis}")
        
        if vis_lis:
            # Click the first one
            first = vis_lis[0]
            if first.get('id'):
                page.locator(f"#{first['id']}").click()
            else:
                page.locator(f"li:has-text('Austin')").first.click()
            clicked = True
            print("Clicked Austin li")
    
    if not clicked:
        page.keyboard.press("Enter")
        print("\nPressed Enter (no suggestion found)")

    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(8000)
    print(f"\nResult page URL: {page.url}")
    print(f"Result page title: {page.title()}")

    if "Access Denied" not in (page.title() or ""):
        # Check filter bar
        filter_info = page.evaluate(r"""() => {
            const out = [];
            // rent/price elements
            const els = document.querySelectorAll('[id*="rent" i], [id*="price" i], [class*="rent" i], [class*="price" i]');
            out.push(`Rent/price elements: ${els.length}`);
            for (const el of [...els].slice(0, 15)) {
                const vis = el.offsetParent !== null || el.getClientRects().length > 0;
                if (vis) {
                    out.push(`  ${el.tagName} id="${el.id}" class="${el.className.toString().substring(0, 80)}" text="${el.textContent?.trim().substring(0, 60)}"`);
                }
            }
            // Cards
            const cards = document.querySelectorAll('article.placard, [data-listingid]');
            out.push(`\nListing cards: ${cards.length}`);
            return out.join('\n');
        }""")
        print(f"\nFilter bar:\n{filter_info}")
    else:
        print("\n*** BLOCKED — Access Denied ***")

    ctx.close()
