"""
Khan Academy – Search for "calculus" → extract course title, description, units.
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="khan_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        # Go directly to the calculus course page
        print("STEP 1: Navigate to Khan Academy Calculus course...")
        page.goto(
            "https://www.khanacademy.org/math/calculus-1",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(5000)

        # Dismiss cookie / sign-up banners
        for sel in ["button:has-text('Accept')", "button:has-text('Got it')",
                     "button:has-text('No thanks')", "[aria-label='Close']",
                     "button:has-text('Maybe later')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load content
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract course info...")

        # Course title
        title = ""
        for sel in ["h1", "[data-test-id='course-title']", ".course-title"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=1500):
                    title = loc.inner_text(timeout=2000).strip()
                    if title:
                        break
            except Exception:
                continue

        # Description
        desc = ""
        for sel in ["[data-test-id='course-description']", ".course-description",
                     "main p", "p"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=1500):
                    desc = loc.inner_text(timeout=2000).strip()
                    if desc and len(desc) > 20:
                        break
            except Exception:
                continue

        # Units / sections
        units = []
        # Strategy 1: body text — capture lines like "Unit 1: Limits and continuity"
        body = page.inner_text("body")
        for line in body.splitlines():
            line = line.strip()
            m = re.match(r'^(Unit\s+\d+)\s*$', line)
            if m:
                units.append(m.group(1))

        # Strategy 2: combine unit number with following title line  
        if units:
            lines = [l.strip() for l in body.splitlines()]
            enriched = []
            for i, line in enumerate(lines):
                m = re.match(r'^(Unit\s+\d+)\s*$', line)
                if m:
                    # Next non-empty line should be the unit title
                    title_line = ""
                    for j in range(i + 1, min(i + 4, len(lines))):
                        if lines[j].strip() and not lines[j].strip().startswith("Unit "):
                            title_line = lines[j].strip()
                            break
                    if title_line:
                        enriched.append(f"{m.group(1)}: {title_line}")
                    else:
                        enriched.append(m.group(1))
            units = enriched

        if not title and not units:
            print("❌ ERROR: Extraction failed — no course data found.")
        else:
            print(f"\nCourse Title: {title}")
            if desc:
                print(f"Description : {desc[:200]}...")
            print(f"\nUnits ({len(units)}):")
            for i, u in enumerate(units, 1):
                print(f"  {i}. {u}")
            results = {"title": title, "description": desc, "units": units}

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
    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
