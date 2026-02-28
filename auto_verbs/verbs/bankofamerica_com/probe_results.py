"""Probe the BoA locator results page DOM structure."""
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
    print(f"URL: {page.url}\n")

    # Dump result list container structure
    info = page.evaluate("""() => {
        const out = [];

        // Look for common list containers
        const candidates = [
            ...document.querySelectorAll('[class*="result"], [class*="location"], [class*="list"], [class*="card"], [id*="result"], [id*="location"]')
        ];
        out.push("=== Candidate containers ===");
        const seen = new Set();
        for (const el of candidates.slice(0, 30)) {
            const key = el.tagName + '.' + el.className + '#' + el.id;
            if (seen.has(key)) continue;
            seen.add(key);
            const childCount = el.children.length;
            const textLen = el.innerText?.length || 0;
            out.push(`  ${el.tagName} class="${el.className}" id="${el.id}" children=${childCount} textLen=${textLen}`);
        }

        // Try to find result items more specifically
        out.push("\\n=== Looking for result items ===");
        // Search for elements containing distance text like "mi"
        const allElements = document.querySelectorAll('*');
        const distEls = [];
        for (const el of allElements) {
            if (el.children.length === 0) {
                const txt = el.textContent?.trim() || '';
                if (/^[\d.]+\s*mi$/i.test(txt)) {
                    distEls.push(el);
                }
            }
        }
        out.push(`Found ${distEls.length} elements with distance text`);
        for (const el of distEls.slice(0, 5)) {
            out.push(`  Distance: "${el.textContent.trim()}" tag=${el.tagName} class="${el.className}"`);
            // Walk up to find the result card container
            let parent = el.parentElement;
            for (let i = 0; i < 8 && parent; i++) {
                out.push(`    parent[${i}]: ${parent.tagName} class="${parent.className}" id="${parent.id}"`);
                parent = parent.parentElement;
            }
        }

        // Also dump the first few h2/h3 elements
        out.push("\\n=== H2/H3 elements ===");
        for (const tag of ['h2', 'h3', 'h4']) {
            const els = document.querySelectorAll(tag);
            for (const el of [...els].slice(0, 5)) {
                out.push(`  ${tag}: "${el.textContent.trim().substring(0, 80)}" class="${el.className}" parent=${el.parentElement?.className}`);
            }
        }

        // Dump the first result card's full HTML (if we can find it)
        out.push("\\n=== First distance element's ancestor HTML ===");
        if (distEls.length > 0) {
            let card = distEls[0];
            for (let i = 0; i < 5; i++) {
                if (card.parentElement) card = card.parentElement;
            }
            out.push(card.outerHTML.substring(0, 3000));
        }

        return out.join("\\n");
    }""")
    print(info)

    ctx.close()
