"""Probe individual result card structure."""
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

    page.goto("https://locators.bankofamerica.com/?q=Redmond,%20WA%2098052")
    page.wait_for_load_state("domcontentloaded")
    page.wait_for_timeout(8000)

    # Get first 3 result cards' inner HTML
    info = page.evaluate(r"""() => {
        const items = document.querySelectorAll('li.map-list-item-wrap.is-visible');
        const out = [];
        for (let i = 0; i < Math.min(3, items.length); i++) {
            out.push(`\n=== Card ${i+1} ===`);
            const item = items[i].querySelector('.map-list-item');
            if (!item) { out.push("  No .map-list-item found"); continue; }
            // Get all direct children with their tag, class, and text
            for (const child of item.children) {
                const tag = child.tagName;
                const cls = child.className;
                const txt = child.innerText?.trim().substring(0, 120) || '';
                out.push(`  ${tag}.${cls}: "${txt}"`);
            }
            out.push(`  --- Full innerText ---`);
            out.push(item.innerText?.trim().substring(0, 500));
        }
        return out.join('\n');
    }""")
    print(info)

    ctx.close()
