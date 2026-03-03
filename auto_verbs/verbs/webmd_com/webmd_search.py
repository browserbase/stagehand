"""
WebMD – Search for symptoms and extract conditions.
Uses the main search functionality, no hardcoded symptom URLs.
Pure Playwright with temp profile.
"""
import re
import os
import shutil
import tempfile
import traceback
from playwright.sync_api import Playwright, sync_playwright

SYMPTOM = "headache"
MAX_RESULTS = 5


def get_temp_profile() -> str:
    """Create a temp Chrome profile for Playwright."""
    tmp = tempfile.mkdtemp(prefix="webmd_chrome_")
    # Copy some Chrome preferences for better compatibility
    chrome_default = os.path.join(
        os.environ.get("LOCALAPPDATA", ""),
        "Google", "Chrome", "User Data", "Default"
    )
    for f in ["Preferences"]:
        src = os.path.join(chrome_default, f)
        if os.path.exists(src):
            try:
                shutil.copy(src, os.path.join(tmp, f))
            except Exception:
                pass
    return tmp


def run(playwright: Playwright) -> list:
    """Search WebMD for a symptom and extract related conditions."""
    profile_path = get_temp_profile()
    print(f"Using temp profile: {profile_path}\n")

    conditions = []
    context = playwright.chromium.launch_persistent_context(
        profile_path,
        channel="chrome",
        headless=False,
        viewport={"width": 1280, "height": 900},
        args=["--disable-blink-features=AutomationControlled"],
    )
    page = context.pages[0] if context.pages else context.new_page()

    try:
        # STEP 1: Navigate to WebMD
        print("STEP 1: Navigate to WebMD...")
        page.goto("https://www.webmd.com", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        # Dismiss cookie/ad popups
        for sel in ["button:has-text('Accept')", "button:has-text('I Accept')",
                    "button:has-text('Got It')", "#onetrust-accept-btn-handler",
                    "[aria-label='Close']", "button:has-text('No Thanks')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=500):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(300)
            except Exception:
                pass

        # STEP 2: Search for the symptom using site search
        print(f"STEP 2: Search for '{SYMPTOM}'...")
        
        # Try various search input selectors
        search_selectors = [
            "input[name='query']",
            "input[placeholder*='Search']",
            "input[type='search']",
            "#search-input",
            "[data-testid='search-input']",
            "input[aria-label*='search' i]",
        ]
        
        search_input = None
        for sel in search_selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=1000):
                    search_input = el
                    break
            except Exception:
                continue
        
        if search_input:
            search_input.click()
            page.wait_for_timeout(500)
            search_input.fill(SYMPTOM)
            page.wait_for_timeout(1000)
            
            # Try to click a suggestion or press Enter
            try:
                # Look for dropdown suggestion
                suggestion = page.locator(f"li:has-text('{SYMPTOM}'), a:has-text('{SYMPTOM}'), [role='option']:has-text('{SYMPTOM}')").first
                if suggestion.is_visible(timeout=1500):
                    suggestion.click()
                else:
                    search_input.press("Enter")
            except Exception:
                search_input.press("Enter")
            
            page.wait_for_timeout(4000)
            print(f"  Search results: {page.url}")
        else:
            # Fallback: go directly to search results page
            print("  Search input not found, using search URL...")
            page.goto(f"https://www.webmd.com/search/search_results/default.aspx?query={SYMPTOM}",
                      wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)

        # STEP 3: Click on a relevant result to get to conditions page
        print("STEP 3: Navigate to conditions page...")
        
        # Look for links related to conditions/symptoms
        result_selectors = [
            "a:has-text('Symptoms')",
            "a:has-text('conditions')",
            f"a:has-text('{SYMPTOM}')",
            ".search-results a",
            "article a",
        ]
        
        for sel in result_selectors:
            try:
                links = page.locator(sel).all()
                for link in links[:5]:
                    href = link.get_attribute("href") or ""
                    text = link.inner_text(timeout=1000).strip()
                    # Skip nav links
                    if any(x in text.lower() for x in ["sign in", "subscribe", "newsletter"]):
                        continue
                    if SYMPTOM.lower() in text.lower() and len(text) > 5:
                        link.click()
                        page.wait_for_timeout(4000)
                        print(f"  Clicked: {text[:50]}")
                        break
                else:
                    continue
                break
            except Exception:
                continue

        # Scroll to load content
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(500)

        # STEP 4: Extract conditions
        print("STEP 4: Extract headache-related conditions...")
        seen = set()
        
        # Strategy 1: Find condition/article links
        links = page.locator("a").all()
        nav_words = {"log in", "sign in", "overview", "symptoms", "causes",
                     "complications", "treatment", "prevention", "diagnosis",
                     "living with", "next steps", "related", "more",
                     "support & resources", "find a doctor", "subscribe",
                     "newsletter", "slideshows", "videos", "quizzes", "home",
                     "health", "drugs", "news", "webmd"}
        
        for link in links:
            if len(conditions) >= MAX_RESULTS:
                break
            try:
                text = link.inner_text(timeout=500).strip()
                text = text.splitlines()[0].strip() if text else ""
                href = link.get_attribute("href") or ""
                
                # Filter for condition-like links
                if (text and 15 < len(text) < 120 
                    and SYMPTOM.lower() in text.lower()
                    and text.lower() not in seen
                    and not any(nw in text.lower() for nw in nav_words)):
                    seen.add(text.lower())
                    full_url = href if href.startswith("http") else f"https://www.webmd.com{href}"
                    conditions.append({"condition": text, "url": full_url})
            except Exception:
                continue

        # Strategy 2: Parse body text for condition-like mentions
        if len(conditions) < MAX_RESULTS:
            body_text = page.inner_text("body")
            lines = [l.strip() for l in body_text.splitlines() if l.strip()]
            for line in lines:
                if len(conditions) >= MAX_RESULTS:
                    break
                if (SYMPTOM.lower() in line.lower() 
                    and 15 < len(line) < 150
                    and line.lower() not in seen
                    and not any(nw in line.lower() for nw in nav_words)):
                    seen.add(line.lower())
                    conditions.append({"condition": line, "url": "N/A"})

        # Print results
        print(f"\n{'=' * 59}")
        print(f"  Results – Top {len(conditions)} {SYMPTOM.title()}-Related Conditions")
        print(f"{'=' * 59}\n")
        
        if conditions:
            for i, c in enumerate(conditions, 1):
                print(f"  {i}. {c['condition']}")
                if c.get('url') and c['url'] != "N/A":
                    print(f"     URL: {c['url'][:80]}")
        else:
            print("  No conditions found.")

    except Exception as e:
        print(f"\nError: {e}")
        traceback.print_exc()
    finally:
        try:
            context.close()
        except Exception:
            pass
        # Clean up temp profile
        try:
            shutil.rmtree(profile_path, ignore_errors=True)
        except Exception:
            pass

    return conditions


if __name__ == "__main__":
    with sync_playwright() as playwright:
        data = run(playwright)
        print(f"\nDone — Found {len(data)} conditions")
