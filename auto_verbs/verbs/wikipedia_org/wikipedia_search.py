"""
Auto-generated Playwright script (Python)
Wikipedia – Article Search & Extract
Search: "Space Needle"
Extract: first paragraph summary + infobox facts (location, height, opened date).

Generated on: 2026-02-28T05:36:54.767Z
Recorded 7 browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os
import re
import traceback
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


def run(
    playwright: Playwright,
    search_term: str = "Space Needle",
) -> dict:
    print("=" * 59)
    print("  Wikipedia – Article Search & Extract")
    print("=" * 59)
    print(f'  Search: "{search_term}"\n')

    port = get_free_port()
    profile_dir = get_temp_profile_dir("wikipedia_org")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {}

    try:
        # ── Navigate to Wikipedia ─────────────────────────────────────
        print(f"Loading: https://en.wikipedia.org")
        page.goto("https://en.wikipedia.org", timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(2000)

        # ── Search for the article ────────────────────────────────────
        print(f'Searching for "{search_term}"...')
        search_input = page.locator("#searchInput, input[name='search']").first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(300)
        search_input.press("Control+a")
        search_input.fill(search_term)
        page.wait_for_timeout(500)
        search_input.press("Enter")
        page.wait_for_timeout(3000)
        print(f"  Loaded: {page.url}\n")

        # ── Extract first paragraph ───────────────────────────────────
        print("Extracting article summary...")
        first_para = ""
        try:
            # The first paragraph in the article body
            paragraphs = page.locator("#mw-content-text .mw-parser-output > p")
            for i in range(paragraphs.count()):
                text = paragraphs.nth(i).inner_text().strip()
                if text and len(text) > 50:
                    first_para = text
                    break
        except Exception:
            pass
        result["summary"] = first_para

        # ── Extract infobox facts ─────────────────────────────────────
        print("Extracting infobox facts...")
        infobox_data = {"location": "N/A", "height": "N/A", "opened": "N/A"}
        try:
            rows = page.locator(".infobox tr")
            for i in range(rows.count()):
                row_text = rows.nth(i).inner_text().strip().lower()
                full_text = rows.nth(i).inner_text().strip()
                if "location" in row_text:
                    parts = full_text.split("\t")
                    if len(parts) >= 2:
                        infobox_data["location"] = parts[-1].strip()
                elif "height" in row_text and infobox_data["height"] == "N/A":
                    parts = full_text.split("\t")
                    if len(parts) >= 2:
                        infobox_data["height"] = parts[-1].strip()
                elif "opened" in row_text or "opening" in row_text:
                    parts = full_text.split("\t")
                    if len(parts) >= 2:
                        infobox_data["opened"] = parts[-1].strip()
        except Exception:
            pass
        result["infobox"] = infobox_data

        # ── Print results ─────────────────────────────────────────────
        print(f"\n{'=' * 59}")
        print("  Results")
        print(f"{'=' * 59}")
        print(f"\n  Summary (first paragraph):")
        print(f"  {result['summary'][:500]}...")
        print(f"\n  Infobox Facts:")
        print(f"     Location: {result['infobox']['location']}")
        print(f"     Height:   {result['infobox']['height']}")
        print(f"     Opened:   {result['infobox']['opened']}")
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
    return result


if __name__ == "__main__":
    with sync_playwright() as playwright:
        data = run(playwright)
        print(f"Done — extracted {len(data)} fields")
