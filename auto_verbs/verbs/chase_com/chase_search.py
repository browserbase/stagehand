"""
Auto-generated Playwright script (Python)
Chase – Branch / ATM Locator
Search: "Seattle, WA 98101"
Extract up to 5 branch/ATM results with name, address, and hours.

Generated on: 2026-02-28T04:18:37.342Z
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
import threading

from dataclasses import dataclass

@dataclass(frozen=True)
class ChaseSearchRequest:
    search_term: str
    max_results: int

@dataclass(frozen=True)
class ChaseBranch:
    name: str
    address: str
    hours: str

@dataclass(frozen=True)
class ChaseSearchResult:
    search_term: str
    branches: list[ChaseBranch]


# Searches for Chase Bank branches and ATMs near a location, returning up to max_results results.
def search_chase_branches(
    playwright,
    request: ChaseSearchRequest,
) -> ChaseSearchResult:
    search_term = request.search_term
    max_results = request.max_results
    raw_results = []
    print("=" * 59)
    print("  Chase – Branch / ATM Locator")
    print("=" * 59)
    print(f"  Search: \"{search_term}\"")
    print(f"  Extract up to {max_results} raw_results\n")

    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default"
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport=None,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    raw_results = []

    def _watchdog():
        print("\n⏱️  WATCHDOG: 90s timeout — closing browser...")
        try:
            context.close()
        except Exception:
            pass
        os._exit(1)

    timer = threading.Timer(90, _watchdog)
    timer.daemon = True
    timer.start()

    try:
        # ── Navigate to Chase locator ─────────────────────────────────────
        print("Loading Chase locator...")
        page.goto("https://locator.chase.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\n")

        # ── Dismiss cookie / popup banners ────────────────────────────────
        for sel in [
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Close')",
            "[aria-label='Close']",
            "button:has-text('No Thanks')",
            "#onetrust-accept-btn-handler",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Search for location ───────────────────────────────────────────
        print(f"Searching for \"{search_term}\"...")

        # Try multiple selectors for the search input
        search_selectors = [
            'input[name="searchText"]',
            'input[id*="earch"]',
            'input[type="search"]',
            'input[placeholder*="Search"]',
            'input[placeholder*="address"]',
            'input[placeholder*="ZIP"]',
            'input[aria-label*="search" i]',
            'input[aria-label*="location" i]',
        ]
        search_input = None
        for sel in search_selectors:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=2000):
                    search_input = loc
                    print(f"  Found search input: {sel}")
                    break
            except Exception:
                continue

        if search_input is None:
            raise Exception("Could not find search input on the page")

        search_input.evaluate("el => el.click()")
        page.keyboard.press("Control+a")
        page.wait_for_timeout(300)
        search_input.fill(search_term)
        page.wait_for_timeout(2000)
        print(f"  Typed: \"{search_term}\"")

        page.keyboard.press("Enter")
        print("  Submitted search")
        page.wait_for_timeout(8000)
        print(f"  Results loaded: {page.url}\n")

        # ── Extract raw_results ───────────────────────────────────────────────
        print(f"Extracting up to {max_results} raw_results...\n")

        # Scroll to load lazy content
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 400)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Try to extract from visible text using regex patterns
        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\n") if l.strip()]

        # Look for blocks that contain addresses (state + ZIP pattern)
        i = 0
        while i < len(lines) and len(raw_results) < max_results:
            line = lines[i]
            # Look for lines with a state abbreviation + ZIP code
            match = re.search(r'[A-Z]{2}\s+\d{5}', line)
            if match:
                # The name is usually 1-3 lines above the address
                name = "Unknown"
                for j in range(max(0, i - 3), i):
                    candidate = lines[j].strip()
                    if candidate and len(candidate) > 3 and not re.search(r'\d{5}', candidate):
                        name = candidate
                        break

                address = line

                # Hours are usually 1-3 lines below the address
                hours = "N/A"
                for j in range(i + 1, min(len(lines), i + 5)):
                    h_line = lines[j]
                    if re.search(r'\d{1,2}:\d{2}\s*(?:AM|PM|am|pm)', h_line):
                        hours = h_line
                        break
                    if re.search(r'(?:Open|Closed|Hours|Mon|Tue|Wed|Thu|Fri|Sat|Sun)', h_line, re.IGNORECASE):
                        hours = h_line
                        break

                # Avoid duplicates
                key = name.lower()
                if key not in [r["name"].lower() for r in raw_results]:
                    raw_results.append({"name": name, "address": address, "hours": hours})
            i += 1

        # ── Print raw_results ─────────────────────────────────────────────────
        print(f"\nFound {len(raw_results)} locations:\n")
        for i, loc in enumerate(raw_results, 1):
            print(f"  {i}. {loc['name']}")
            print(f"     Address: {loc['address']}")
            print(f"     Hours:   {loc['hours']}")
            print()

    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()
    finally:
        timer.cancel()
        try:
            context.close()
        except Exception:
            pass
    return ChaseSearchResult(
        search_term=search_term,
        branches=[ChaseBranch(name=r["name"], address=r["address"], hours=r["hours"]) for r in raw_results],
    )
def test_search_chase_branches() -> None:
    from playwright.sync_api import sync_playwright
    request = ChaseSearchRequest(search_term="Seattle, WA 98101", max_results=5)
    with sync_playwright() as playwright:
        result = search_chase_branches(playwright, request)
    assert result.search_term == request.search_term
    assert len(result.branches) <= request.max_results
    print(f"\nTotal branches found: {len(result.branches)}")


if __name__ == "__main__":
    test_search_chase_branches()
