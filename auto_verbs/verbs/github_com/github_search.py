"""
Auto-generated Playwright script (Python)
GitHub – Repository Search
Search: "browser automation"
Sort by: Most stars
Extract up to 5 repos with name, owner, stars, language, description.

Generated on: 2026-02-28T05:38:54.092Z
Recorded 3 browser interactions

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
    search_term: str = "browser automation",
    max_results: int = 5,
) -> list:
    print("=" * 59)
    print("  GitHub – Repository Search")
    print("=" * 59)
    print(f'  Search: "{search_term}"')
    print(f"  Sort by: Most stars")
    print(f"  Extract up to {max_results} repos\n")

    port = get_free_port()
    profile_dir = get_temp_profile_dir("github_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate directly to search results sorted by stars ────────
        search_url = f"https://github.com/search?q={search_term.replace(' ', '+')}&type=repositories&s=stars&o=desc"
        print(f"Loading: {search_url}")
        page.goto(search_url, timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\n")

        # ── Scroll to load content ────────────────────────────────────
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # ── Extract results ───────────────────────────────────────────
        print(f"Extracting up to {max_results} repos...\n")

        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\n") if l.strip()]

        i = 0
        while i < len(lines) and len(results) < max_results:
            line = lines[i]
            # Look for repo pattern: owner/name
            if "/" in line and not line.startswith("http") and not line.startswith("#"):
                parts = line.split("/")
                if len(parts) == 2 and len(parts[0]) < 40 and len(parts[1]) < 80:
                    owner = parts[0].strip()
                    name = parts[1].strip()
                    # Skip navigation / header items
                    if owner.lower() in ("github", "search", "explore", "topics", "trending", "collections", "events", "about"):
                        i += 1
                        continue

                    repo = {
                        "owner": owner,
                        "name": name,
                        "stars": "N/A",
                        "language": "N/A",
                        "description": "N/A",
                    }

                    # Look ahead for description, stars, language
                    for j in range(i + 1, min(len(lines), i + 10)):
                        cand = lines[j].strip()
                        cl = cand.lower()

                        # Stars count
                        if re.search(r'[\d,]+\s*$', cand) and len(cand) < 15:
                            repo["stars"] = cand
                            continue

                        # Language
                        if cand in ("Python", "JavaScript", "TypeScript", "Java", "Go",
                                    "Rust", "C++", "C#", "Ruby", "PHP", "Swift", "Kotlin",
                                    "Shell", "C", "Scala", "R", "Dart", "HTML", "CSS"):
                            repo["language"] = cand
                            continue

                        # Description (longer text without special patterns)
                        if len(cand) > 30 and not cand.startswith("Updated") and "/" not in cand:
                            if repo["description"] == "N/A":
                                repo["description"] = cand

                    # Avoid duplicates
                    key = f"{repo['owner']}/{repo['name']}"
                    if key not in [f"{r['owner']}/{r['name']}" for r in results]:
                        results.append(repo)

            i += 1

        # ── Print results ─────────────────────────────────────────────
        print(f"\nFound {len(results)} repos:\n")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['owner']}/{r['name']}")
            print(f"     Stars:       {r['stars']}")
            print(f"     Language:    {r['language']}")
            print(f"     Description: {r['description'][:100]}")
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
