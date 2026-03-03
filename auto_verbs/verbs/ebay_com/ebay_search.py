"""
eBay – Vintage Mechanical Keyboard Search
Search: "vintage mechanical keyboard" | Filter: Buy It Now | Sort: Price + Shipping lowest

Pure Playwright – no AI. Uses .s-item CSS class selectors discovered via exploration.
"""

import re
import os
import shutil
import tempfile
import traceback
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY = "vintage mechanical keyboard"
MAX_RESULTS = 5
URL = "https://www.ebay.com/sch/i.html?_nkw=vintage%20mechanical%20keyboard&LH_BIN=1&_sop=15"


def get_temp_profile_dir(site="ebay"):
    """Create a temp Chrome profile dir to avoid locking the real one."""
    tmp = os.path.join(tempfile.gettempdir(), f"{site}_chrome_profile_{os.getpid()}")
    os.makedirs(tmp, exist_ok=True)
    src = os.path.join(
        os.environ.get("LOCALAPPDATA", ""),
        "Google", "Chrome", "User Data", "Default",
    )
    for f in ["Preferences", "Local State"]:
        s = os.path.join(src, f)
        if os.path.exists(s):
            shutil.copy2(s, os.path.join(tmp, f))
    return tmp


def dismiss_popups(page):
    """Dismiss cookie / GDPR popups."""
    for sel in [
        "#gdpr-banner-accept",
        "button:has-text('Accept')",
        "button:has-text('Accept All')",
        "button:has-text('Got it')",
        "button:has-text('OK')",
    ]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.evaluate("el => el.click()")
                page.wait_for_timeout(300)
        except Exception:
            pass


def run(
    playwright: Playwright,
    search_query: str = QUERY,
    max_results: int = MAX_RESULTS,
) -> list:
    print("=" * 60)
    print("  eBay – Vintage Mechanical Keyboard Search")
    print("=" * 60)
    print(f'  Query: "{search_query}"')
    print(f"  Filter: Buy It Now | Sort: Price + Shipping lowest")
    print(f"  Max results: {max_results}\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("ebay_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        print("STEP 1: Navigate to eBay search results...")
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        dismiss_popups(page)
        print(f"   Loaded: {page.url}\n")

        # Wait for results to render — try most likely selector first
        loaded = False
        for wait_sel in [".srp-results", "li.s-item", ".s-item__title", "[data-viewport]"]:
            try:
                page.wait_for_selector(wait_sel, timeout=5000)
                print(f"   ✅ Selector '{wait_sel}' appeared")
                loaded = True
                break
            except Exception:
                pass

        if not loaded:
            print("   ⚠ No known result selector appeared — will try fallbacks")

        # Scroll to trigger lazy loading
        for _ in range(2):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)

        print("STEP 2: Extract product listings...")

        # ──────────────────────────────────────────────────────
        # Strategy 1: Single JS evaluate — extracts all at once, no per-element timeouts
        # ──────────────────────────────────────────────────────
        skip_phrases = ["shop on ebay", "picks for you", "results matching", "related:", "save this search", "trending on", "see all", "sponsored"]

        all_items = page.evaluate("""(max) => {
            const results = [];
            const skip = ["shop on ebay", "picks for you", "results matching", "related:", "save this search", "trending on", "see all", "sponsored"];

            // Try .s-item first, then .srp-results > li
            let items = document.querySelectorAll('li.s-item');
            if (items.length === 0) items = document.querySelectorAll('.srp-results > li');

            for (const item of items) {
                if (results.length >= max) break;

                // Title: try .s-item__title, then role=heading, then first link
                let title = '';
                const titleEl = item.querySelector('.s-item__title') || item.querySelector('[role="heading"]');
                if (titleEl) title = titleEl.innerText.trim();
                if (!title) {
                    const linkEl = item.querySelector('a.s-item__link, a');
                    if (linkEl) title = linkEl.innerText.trim();
                }
                // Clean "Opens in a new window or tab"
                title = title.replace(/Opens in a new window or tab/gi, '').trim();

                if (!title || title.length < 5) continue;
                const lower = title.toLowerCase();
                if (skip.some(s => lower.startsWith(s))) continue;

                // Price
                let price = '';
                const priceEl = item.querySelector('.s-item__price') || item.querySelector('[class*="price"]');
                if (priceEl) price = priceEl.innerText.trim();
                if (!price) {
                    const m = item.innerText.match(/\\$(\\d[\\d,.]*)/);
                    if (m) price = '$' + m[1];
                }

                // Shipping
                let shipping = 'N/A';
                const shipEl = item.querySelector('.s-item__shipping') || item.querySelector('.s-item__freeXDays') || item.querySelector('[class*="shipping"]');
                if (shipEl) shipping = shipEl.innerText.trim();
                if (shipping === 'N/A') {
                    const lines = item.innerText.split('\\n');
                    for (const l of lines) {
                        if (/shipping|free\\s/i.test(l.trim())) { shipping = l.trim(); break; }
                    }
                }

                if (title && price) results.push({ title: title.substring(0, 120), price, shipping });
            }
            return results;
        }""", max_results)

        if all_items:
            results = all_items
            print(f"   ✅ JS evaluate extracted {len(results)} items")

        # ──────────────────────────────────────────────────────
        # Strategy 2: Fallback — full page text with regex
        # ──────────────────────────────────────────────────────
        if not results:
            print("   ⚠ JS evaluate returned 0 — trying text fallback...")
            body = page.locator("body").inner_text(timeout=15000)
            lines = [l.strip() for l in body.split("\n") if l.strip()]

            i = 0
            while i < len(lines) and len(results) < max_results:
                line = lines[i]
                if (len(line) >= 20 and not line.startswith("$")
                    and not any(line.lower().startswith(p) for p in skip_phrases)
                    and any(c.isalpha() for c in line)):
                    price = ""
                    shipping = "N/A"
                    for j in range(0, 6):
                        if i + j >= len(lines):
                            break
                        nxt = lines[i + j]
                        pm = re.search(r"\$[\d,.]+", nxt)
                        if pm and not price:
                            price = pm.group(0)
                        if re.search(r"(shipping|free\s)", nxt, re.IGNORECASE) and shipping == "N/A":
                            shipping = nxt.strip()[:80]
                    if price:
                        results.append({"title": line[:120], "price": price, "shipping": shipping})
                        i += 5
                    else:
                        i += 1
                else:
                    i += 1

        print(f"\n" + "=" * 60)
        print(f"  DONE – {len(results)} results")
        print("=" * 60)
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['title']}")
            print(f"     Price:    {r['price']}")
            print(f"     Shipping: {r['shipping']}")
            print()

    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)

    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"Total results: {len(items)}")
