"""
Netflix – Search for "documentary"
Pure Playwright – no AI.
NOTE: Netflix requires login. Falls back to genre browse page if not logged in.
"""
import re, os, sys, traceback, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("netflix_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    shows = []
    try:
        print("STEP 1: Navigate to Netflix search...")
        page.goto(
            "https://www.netflix.com/search?q=documentary",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(8000)

        # Check if login required
        current_url = page.url.lower()
        not_logged_in = ("login" in current_url or "signup" in current_url
                         or "loginglobals" in current_url)
        if not_logged_in:
            print("   Not logged in – trying genre browse page (Documentaries)...")
            page.goto(
                "https://www.netflix.com/browse/genre/6839",
                wait_until="domcontentloaded", timeout=30000,
            )
            page.wait_for_timeout(5000)
            current_url = page.url.lower()
            not_logged_in = "login" in current_url or "signup" in current_url

        if not_logged_in:
            print("❌ ERROR: Netflix requires login. Please sign in to Netflix in Chrome first.")
            print(f"\nDONE – Top 0 Documentary Results:")
            return shows

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "[aria-label='Close']",
                     "button:has-text('Not Now')", "button:has-text('Dismiss')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(400)
            except Exception:
                pass

        # Scroll
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract shows...")

        # ── Strategy 1: Netflix card selectors ──
        seen = set()
        card_sels = [
            ".title-card",
            ".slider-item",
            "[data-testid='title-card']",
            ".ptrack-content",
            "[class*='titleCard']",
            ".boxart-container",
        ]
        for sel in card_sels:
            if len(shows) >= MAX_RESULTS:
                break
            try:
                cards = page.locator(sel).all()
                if not cards:
                    continue
                print(f"   Selector '{sel}' → {len(cards)} elements")
                for card in cards:
                    if len(shows) >= MAX_RESULTS:
                        break
                    try:
                        # Try to get title from img alt or aria-label
                        title = ""
                        try:
                            img = card.locator("img").first
                            title = img.get_attribute("alt", timeout=1000) or ""
                        except Exception:
                            pass
                        if not title:
                            try:
                                title = card.get_attribute("aria-label") or ""
                            except Exception:
                                pass
                        if not title:
                            try:
                                fallback = card.locator(".fallback-text, p, span").first
                                title = fallback.inner_text(timeout=1000)
                            except Exception:
                                pass

                        title = title.strip()
                        if title and len(title) > 1 and len(title) < 120:
                            key = title.lower()
                            if key not in seen:
                                seen.add(key)
                                shows.append({
                                    "title": title,
                                    "genre": "Documentary",
                                    "match_or_rating": "N/A",
                                })
                    except Exception:
                        continue
            except Exception:
                continue

        # ── Strategy 2: aria-label on links ──
        if not shows:
            print("   Card selectors found 0 – trying link aria-labels...")
            try:
                links = page.locator("a[aria-label]").all()
                for link in links:
                    if len(shows) >= MAX_RESULTS:
                        break
                    try:
                        label = link.get_attribute("aria-label") or ""
                        href = link.get_attribute("href") or ""
                        if "/title/" in href or "/watch/" in href:
                            label = label.strip()
                            # Strip "Go to " prefix from aria-labels
                            if label.lower().startswith("go to "):
                                label = label[6:]
                            if label and len(label) > 2 and len(label) < 120:
                                key = label.lower()
                                if key not in seen:
                                    seen.add(key)
                                    shows.append({
                                        "title": label,
                                        "genre": "Documentary",
                                        "match_or_rating": "N/A",
                                    })
                    except Exception:
                        continue
            except Exception:
                pass

        # ── Strategy 3: body text fallback ──
        if not shows:
            print("   Trying body text fallback...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            nav_words = {
                "home", "search", "browse", "my list", "new & popular",
                "categories", "account", "sign out", "help center",
                "netflix", "audio description", "privacy", "terms",
                "cookie", "contact", "profiles", "manage profiles",
            }
            for ln in lines:
                if len(shows) >= MAX_RESULTS:
                    break
                ll = ln.lower()
                if (len(ln) > 3 and len(ln) < 80
                    and ll not in nav_words
                    and not re.search(r"sign|log|browse|search|home|account|menu|netflix|help|privacy|cookie|terms", ll)
                    and not re.match(r"^\d+$", ln)):
                    key = ll
                    if key not in seen:
                        seen.add(key)
                        shows.append({
                            "title": ln,
                            "genre": "Documentary",
                            "match_or_rating": "N/A",
                        })

        if not shows:
            print("❌ ERROR: Extraction failed — no shows found.")

        print(f"\nDONE – Top {len(shows)} Documentary Results:")
        for i, s in enumerate(shows, 1):
            print(f"  {i}. {s['title']} | Genre: {s['genre']} | {s['match_or_rating']}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return shows


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
