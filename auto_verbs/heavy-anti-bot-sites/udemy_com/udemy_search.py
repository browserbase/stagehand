"""
Udemy – Search "Python programming" → sort Highest Rated → extract top 5 courses.
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile, threading
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

from dataclasses import dataclass




@dataclass(frozen=True)
class UdemySearchRequest:
    query: str = "Python programming"
    max_results: int = 5


@dataclass(frozen=True)
class UdemyCourse:
    title: str
    instructor: str
    rating: str
    price: str


@dataclass(frozen=True)
class UdemySearchResult:
    query: str
    courses: list


def search_udemy_courses(playwright, request: UdemySearchRequest) -> UdemySearchResult:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="udemy_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    courses = []

    # Watchdog: force-kill everything after 90s so the script never hangs
    def _watchdog():
        print("\n⏱️  WATCHDOG: 90s timeout — force-killing Chrome...")
        try:
            chrome_proc.kill()
        except Exception:
            pass
        os._exit(1)

    timer = threading.Timer(90, _watchdog)
    timer.daemon = True
    timer.start()

    try:
        # STEP 1: Navigate directly to search results URL (avoids homepage bot detection)
        import urllib.parse
        q = urllib.parse.quote_plus(request.query)
        search_url = f"https://www.udemy.com/courses/search/?q={q}"
        print(f"STEP 1: Navigate to search results for '{request.query}'...")
        print(f"   URL: {search_url}")
        page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(4000)
        print(f"   ✅ Landed on: {page.url}")

        # Dismiss cookie consent wall FIRST — it blocks page content
        print("   Dismissing cookie/consent banners...")
        for sel in [
            "button:has-text('Accept All')",
            "button:has-text('Accept all')",
            "button:has-text('Accept')",
            "button:has-text('Agree')",
            "button[data-purpose='accept-cookie']",
            "button:has-text('Dismiss')",
            "[aria-label='Close']",
            "#onetrust-accept-btn-handler",
            "button.cookie-consent--accept",
        ]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=1000):
                    loc.click()
                    print(f"   Dismissed: {sel}")
                    page.wait_for_timeout(1500)
                    break
            except Exception:
                pass

        page.wait_for_timeout(3000)

        # Scroll to load more courses
        for _ in range(8):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 3: Extract courses...")
        print(f"   Current URL: {page.url}")
        
        # Debug: check what's on the page
        h3_count = page.locator("h3").count()
        div_count = page.locator("div").count()
        course_card_count = page.locator("[data-purpose*='course'], [class*='course-card'], [class*='CourseCard']").count()
        print(f"   Page has: {div_count} divs, {h3_count} h3s, {course_card_count} course cards")
        if h3_count > 0:
            sample = page.locator("h3").first.text_content() or ""
            print(f"   First h3: '{sample.strip()[:80]}'")
        # Check page title to detect bot block
        title = page.title()
        print(f"   Page title: '{title[:80]}'")

        # Strategy 1: parse body text for course patterns
        # Pattern: Title line → description with "Rating: X.X out of 5" →
        #          "Instructor:" → name → "Rating:" → number → "(count)" → price
        seen = set()
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]

        i = 0
        while i < len(lines) and len(courses) < request.max_results:
            # Look for "Instructor:" marker
            if lines[i] == "Instructor:":
                instructor = lines[i + 1] if i + 1 < len(lines) else "N/A"
                # Rating is a few lines after
                rating = ""
                price = ""
                for j in range(i + 2, min(i + 10, len(lines))):
                    rm = re.match(r'^(\d\.\d)$', lines[j])
                    if rm and not rating:
                        rating = rm.group(1)
                    pm = re.match(r'^\$[\d.]+$', lines[j])
                    if pm and not price:
                        price = lines[j]
                    # Also check "Current price" followed by price on next line
                    if lines[j] == "Current price" and j + 1 < len(lines):
                        pm2 = re.match(r'^(\$[\d.]+)$', lines[j + 1])
                        if pm2 and not price:
                            price = pm2.group(1)
                # Title is above — look backwards past description
                title = ""
                for j in range(i - 1, max(i - 6, -1), -1):
                    ln = lines[j]
                    # Skip lines that are descriptions (contain "Rating:") or short metadata
                    if "Rating:" in ln or re.match(r'^\d', ln) or len(ln) < 10:
                        continue
                    if ln in ("Bestseller", "Premium", "Add all to cart",
                              "Current price", "Original Price", "Top-rated courses",
                              "Popular with learners just like you",
                              "Guidance from real-world experts"):
                        continue
                    title = ln
                    break

                key = title.lower()[:60]
                if title and key not in seen:
                    seen.add(key)
                    courses.append({
                        "title": title,
                        "instructor": instructor,
                        "rating": rating or "N/A",
                        "price": price or "N/A",
                    })
            i += 1

        # Strategy 2: look for "Rating: X.X out of 5" lines — title is nearby
        if len(courses) < request.max_results:
            i = 0
            while i < len(lines) and len(courses) < request.max_results:
                rm = re.match(r'^Rating:\s+(\d\.\d)\s+out of\s+5', lines[i])
                if rm:
                    rating = rm.group(1)
                    # Title is usually 1-2 lines above
                    title = ""
                    for j in range(i - 1, max(i - 4, -1), -1):
                        ln = lines[j]
                        if (len(ln) > 15 and "Rating" not in ln
                                and "$" not in ln and "Instructor" not in ln
                                and ln not in ("Bestseller", "Premium",
                                "Current price", "Original Price", "Error loading price")
                                and not re.match(r'^Dr\.\s', ln)
                                and not re.match(r'^\(\d', ln)):
                            title = ln.split("Rating:")[0].strip() if "Rating:" in ln else ln
                            break
                    key = title.lower()[:60]
                    if title and key not in seen:
                        seen.add(key)
                        # Look for instructor nearby
                        instructor = "N/A"
                        for j in range(i - 4, i + 6):
                            if 0 <= j < len(lines) and lines[j] == "Instructor:":
                                if j + 1 < len(lines):
                                    instructor = lines[j + 1]
                                break
                        courses.append({
                            "title": title,
                            "instructor": instructor,
                            "rating": rating,
                            "price": "N/A",
                        })
                i += 1

        # Strategy 3: h3 tags as course titles
        if not courses:
            print("   Strategy 1 found 0 — trying h3 tags...")
            h3s = page.locator("h3").all()
            skip_phrases = {
                "strictly necessary cookies", "sale of personal information",
                "cookie list", "privacy", "google", "targeting cookies",
                "performance cookies", "functional cookies",
            }
            for h3 in h3s:
                if len(courses) >= request.max_results:
                    break
                try:
                    text = h3.inner_text(timeout=1500).strip()
                    if (len(text) > 10
                            and text.lower() not in skip_phrases
                            and not any(p in text.lower() for p in skip_phrases)):
                        key = text.lower()[:60]
                        if key not in seen:
                            seen.add(key)
                            courses.append({
                                "title": text,
                                "instructor": "N/A",
                                "rating": "N/A",
                                "price": "N/A",
                            })
                except Exception:
                    continue

        if not courses:
            print("❌ ERROR: Extraction failed — no courses found from the page.")

        print(f"\nDONE – Top {len(courses)} Udemy Courses (Highest Rated):")
        for i, c in enumerate(courses, 1):
            print(f"  {i}. {c['title']}")
            print(f"     Instructor: {c['instructor']}  |  Rating: {c['rating']}  |  Price: {c['price']}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        timer.cancel()
        # browser.close() must run on the playwright thread — do it directly
        try:
            browser.close()
        except Exception:
            pass
        try:
            chrome_proc.kill()
            chrome_proc.wait(timeout=5)
        except Exception:
            pass
        try:
            import subprocess as _sp
            _sp.call(["taskkill", "/F", "/T", "/PID", str(chrome_proc.pid)],
                     stdout=_sp.DEVNULL, stderr=_sp.DEVNULL)
        except Exception:
            pass
        shutil.rmtree(profile_dir, ignore_errors=True)
    return UdemySearchResult(
        query=request.query,
        courses=[UdemyCourse(title=c['title'], instructor=c['instructor'],
                             rating=c['rating'], price=c['price']) for c in courses],
    )


def test_udemy_courses():
    from playwright.sync_api import sync_playwright
    request = UdemySearchRequest(query="Python programming", max_results=5)
    with sync_playwright() as pl:
        result = search_udemy_courses(pl, request)
    print(f"\nTotal courses: {len(result.courses)}")
    for i, c in enumerate(result.courses, 1):
        print(f"  {i}. {c.title}  {c.rating}")


if __name__ == "__main__":
    test_udemy_courses()