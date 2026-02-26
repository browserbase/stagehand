"""
Auto-generated Playwright script (Python)
YouTube Video Search: "anchorage museums"

Generated on: 2026-02-26T18:57:25.156Z
Recorded 11 browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright, search_query: str = "anchorage museums", max_results: int = 5) -> list:
    """
    Search YouTube for the given query and return up to max_results video results,
    each with url, title, and duration.
    """
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
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
            "--start-maximized",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()

    results = []

    try:
        # Navigate to YouTube
        page.goto("https://www.youtube.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Find and fill the search box
        search_input = page.get_by_role("combobox", name=re.compile(r"Search", re.IGNORECASE)).first
        search_input.click()
        search_input.fill(search_query)
        page.wait_for_timeout(500)

        # Submit the search
        search_input.press("Enter")

        # Wait for search results to load
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # Extract video results
        # YouTube video links have /watch?v= in the href
        # Duration is shown as overlay text on the thumbnail
        video_renderers = page.locator("ytd-video-renderer")
        count = video_renderers.count()
        if count == 0:
            # Fallback: try the general video list item
            video_renderers = page.locator("#contents ytd-video-renderer, #contents ytd-rich-item-renderer")
            count = video_renderers.count()

        for i in range(min(count, max_results)):
            renderer = video_renderers.nth(i)
            try:
                # Get the video URL and title from the title link
                title_link = renderer.locator("a#video-title").first
                href = title_link.get_attribute("href", timeout=2000) or ""
                if not href.startswith("http"):
                    href = "https://www.youtube.com" + href
                title = title_link.inner_text(timeout=2000).strip()

                # Get the duration from the time-status overlay
                duration = "N/A"
                try:
                    time_el = renderer.locator("span#text.ytd-thumbnail-overlay-time-status-renderer, badge-shape .badge-shape-wiz__text, span.ytd-thumbnail-overlay-time-status-renderer").first
                    duration = time_el.inner_text(timeout=2000).strip()
                except Exception:
                    # Try alternative: the time display in the thumbnail
                    try:
                        time_el = renderer.locator("[overlay-style='DEFAULT'] span").first
                        duration = time_el.inner_text(timeout=2000).strip()
                    except Exception:
                        pass

                results.append({"url": href, "title": title, "duration": duration})
            except Exception:
                continue

        if not results:
            # Fallback: extract video links from page
            print("Primary extraction failed, trying link-based fallback...")
            all_links = page.get_by_role("link").all()
            seen = set()
            for link in all_links:
                try:
                    href = link.get_attribute("href", timeout=500) or ""
                    if "/watch?v=" in href and href not in seen:
                        seen.add(href)
                        if not href.startswith("http"):
                            href = "https://www.youtube.com" + href
                        label = link.inner_text(timeout=500).strip() or "N/A"
                        results.append({"url": href, "title": label, "duration": "N/A"})
                        if len(results) >= max_results:
                            break
                except Exception:
                    continue

        if not results:
            print("Warning: Could not find any video results.")

        # Print results
        print(f"\nFound {len(results)} video results for '{search_query}':\n")
        for i, item in enumerate(results, 1):
            print(f"  {i}. {item['title']}")
            print(f"     URL: {item['url']}")
            print(f"     Duration: {item['duration']}")

    except Exception as e:
        print(f"Error searching YouTube: {e}")
    finally:
        context.close()

    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"\nTotal videos found: {len(items)}")
