"""
Auto-generated Playwright script (Python)
CVS – Store Locator
Zip Code: "10001"
Extract up to 5 stores with address, phone, hours, pharmacy, MinuteClinic.

Generated on: 2026-02-28T05:25:48.911Z
Recorded 7 browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os
import re
import time
import traceback
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


def run(
    playwright: Playwright,
    zip_code: str = "10001",
    max_results: int = 5,
) -> list:
    print("=" * 59)
    print("  CVS – Store Locator")
    print("=" * 59)
    print(f"  Zip Code: \"{zip_code}\"")
    print(f"  Extract up to {max_results} stores\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("cvs_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate to store locator landing page ──────────────────
        landing_url = "https://www.cvs.com/store-locator/landing"
        print(f"Loading: {landing_url}")
        page.goto(landing_url, timeout=45000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\n")

        # ── Dismiss cookie / popup banners ────────────────────────────
        for sel in [
            "#onetrust-accept-btn-handler",
            "button.onetrust-close-btn-handler",
            "button:has-text('Accept All')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Search by zip code ────────────────────────────────────────
        print(f"Searching for stores near {zip_code}...")
        search_input = page.locator("cvs-combobox input, input[aria-label*='Search']").first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        search_input.press("Control+a")
        search_input.fill(zip_code)
        page.wait_for_timeout(1000)
        search_input.press("Enter")
        page.wait_for_timeout(8000)
        print(f"  Results loaded: {page.url}\n")

        # ── Scroll to load content ────────────────────────────────────
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # ── Extract results ───────────────────────────────────────────
        print(f"Extracting up to {max_results} stores...\n")

        # CVS uses web components (shadow DOM) for store cards, so
        # document.body.innerText doesn't include store data.
        # Use a JS script that traverses shadow roots to extract text,
        # skipping <style> and <script> elements.
        body_text = page.evaluate("""() => {
            function getDeepText(node) {
                let text = '';
                if (node.shadowRoot) {
                    text += getDeepText(node.shadowRoot);
                }
                for (const child of node.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE) {
                        const t = child.textContent.trim();
                        if (t) text += t + '\\n';
                    } else if (child.nodeType === Node.ELEMENT_NODE) {
                        const tag = child.tagName.toLowerCase();
                        if (tag !== 'style' && tag !== 'script' && tag !== 'noscript') {
                            text += getDeepText(child);
                        }
                    }
                }
                return text;
            }
            return getDeepText(document.body);
        }""") or ""
        lines = [l.strip() for l in body_text.split("\n") if l.strip()]

        # ── Extract results using CVS page structure ────────────────
        # CVS store listings follow a consistent pattern:
        #   [number] -> address -> CITY, ST, ZIP -> ... phone -> hours -> services
        # Find store blocks by looking for lines that are just a single number (1-9)
        store_starts = []
        for k, ln in enumerate(lines):
            if re.match(r'^\d$', ln) and k > 0:
                # Verify it's preceded by "X.X miles" (distance indicator)
                prev = lines[k - 1] if k > 0 else ""
                if "mile" in prev.lower():
                    store_starts.append(k)

        for si, start_idx in enumerate(store_starts):
            if len(results) >= max_results:
                break
            # Determine end of this store block
            end_idx = store_starts[si + 1] - 2 if si + 1 < len(store_starts) else min(start_idx + 25, len(lines))

            block = lines[start_idx + 1 : end_idx]  # skip the number line
            store = {
                "address": "N/A",
                "phone": "N/A",
                "hours": "N/A",
                "has_pharmacy": "Unknown",
                "has_minuteclinic": "Unknown",
            }

            # First line is always the street address
            if block:
                store["address"] = block[0]

            for j, bl in enumerate(block):
                cl = bl.lower()

                # City, State, Zip
                if re.match(r'^[A-Z].*,\s*[A-Z]{2}\s*,?\s*\d{5}', bl):
                    store["address"] = f"{store['address']}, {bl}"

                # Phone number
                elif re.search(r'\(\d{3}\)\s*\d{3}[\s.-]?\d{4}', bl):
                    m = re.search(r'\(\d{3}\)\s*\d{3}[\s.-]?\d{4}', bl)
                    if m:
                        store["phone"] = m.group(0)

                # Store hours — look for "Open 24 hours" or combine Open/Closed lines
                elif cl in ("open", "closed") and store["hours"] == "N/A":
                    # Peek at next line for details
                    nxt = block[j + 1].strip() if j + 1 < len(block) else ""
                    if nxt.startswith(","):
                        store["hours"] = f"{bl}{nxt}"
                    elif "hour" in nxt.lower() or re.search(r'\d', nxt):
                        store["hours"] = f"{bl} {nxt}"
                    else:
                        store["hours"] = bl

                # Pharmacy
                elif cl == "pharmacy:" or cl.startswith("pharmacy"):
                    store["has_pharmacy"] = "Yes"

                # MinuteClinic
                elif "minuteclinic" in cl:
                    store["has_minuteclinic"] = "Yes"

            if store["address"] != "N/A":
                results.append(store)

        # ── Print results ─────────────────────────────────────────────
        print(f"\nFound {len(results)} stores:\n")
        for i, s in enumerate(results, 1):
            print(f"  {i}. {s['address']}")
            print(f"     Phone:        {s['phone']}")
            print(f"     Hours:        {s['hours']}")
            print(f"     Pharmacy:     {s['has_pharmacy']}")
            print(f"     MinuteClinic: {s['has_minuteclinic']}")
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
