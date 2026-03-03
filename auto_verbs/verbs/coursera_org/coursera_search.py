"""
Auto-generated Playwright script (Python)
Coursera – Course Search
Search: "machine learning"
Filter: Free
Extract up to 5 courses with title, provider, rating, enrollment.

Generated on: 2026-02-28T04:48:13.776Z
Recorded 8 browser interactions

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
    search_term: str = "machine learning",
    max_results: int = 5,
) -> list:
    print("=" * 59)
    print("  Coursera – Course Search")
    print("=" * 59)
    print(f"  Search: \"{search_term}\"")
    print(f"  Filter: Free")
    print(f"  Extract up to {max_results} results\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("coursera_org")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate to search results directly ──────────────────────
        from urllib.parse import quote_plus
        search_url = f"https://www.coursera.org/search?query={quote_plus(search_term)}&productFree=true"
        print(f"Loading: {search_url}")
        page.goto(search_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\n")

        # ── Dismiss cookie / popup banners ────────────────────────────
        for sel in [
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Got it')",
            "[aria-label='Close']",
            "#onetrust-accept-btn-handler",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Extract results ───────────────────────────────────────────
        print(f"Extracting up to {max_results} results...\n")

        # Scroll to load content
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Extract using page text with heuristics
        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\n") if l.strip()]

        # Lines to skip when looking for course titles
        skip_prefixes = [
            "status:", "skills you", "coursera", "filter", "sort",
            "topic", "duration", "language", "level", "learning product",
            "all results", "show more", "you might", "skip to",
            "for individuals", "for businesses", "for universities",
            "for governments", "explore", "degrees", "log in", "join",
            "ai overview", "understanding", "start with", "begin with",
            "learn about", "build skills", "enhance your",
            "multiple educators",
        ]

        seen = set()
        for i, line in enumerate(lines):
            if len(results) >= max_results:
                break
            # Look for rating patterns like "4.8" or "4.9(10K reviews)"
            if re.search(r'^\d\.\d\b', line):
                title = "Unknown"
                provider = "N/A"
                enrollment = "N/A"

                for j in range(i - 1, max(0, i - 8), -1):
                    cand = lines[j].strip()
                    cl = cand.lower()
                    if not cand or len(cand) < 5:
                        continue
                    if any(cl.startswith(p) for p in skip_prefixes):
                        continue
                    if provider == "N/A" and any(kw in cl for kw in [
                        "university", "institute", "google", "stanford",
                        "deeplearning", "ibm", "meta", "microsoft",
                        "aws", "duke", "johns hopkins",
                    ]):
                        provider = cand
                        continue
                    if title == "Unknown" and len(cand) > 8:
                        title = cand

                # Look for review/enrollment count near the rating
                for j in range(max(0, i - 1), min(len(lines), i + 4)):
                    m = re.search(
                        r'[\d,.]+[kKmM]?\s*(?:students?|enrolled|learners?|reviews?|ratings?)',
                        lines[j], re.IGNORECASE
                    )
                    if m:
                        enrollment = m.group(0)
                        break

                rating = line.split()[0] if line.split() else "N/A"
                key = title.lower()
                if key not in seen and title != "Unknown":
                    seen.add(key)
                    results.append({
                        "title": title,
                        "provider": provider,
                        "rating": rating,
                        "enrollment": enrollment,
                    })

        # ── Print results ─────────────────────────────────────────────
        print(f"\nFound {len(results)} courses:\n")
        for i, c in enumerate(results, 1):
            print(f"  {i}. {c['title']}")
            print(f"     Provider:   {c['provider']}")
            print(f"     Rating:     {c['rating']}")
            print(f"     Enrollment: {c['enrollment']}")
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
