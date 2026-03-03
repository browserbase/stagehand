"""
Udemy – Search "Python programming" → sort Highest Rated → extract top 5 courses.
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="udemy_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    courses = []
    try:
        # Navigate to Udemy Python topic page
        print("STEP 1: Navigate to Udemy Python topic page...")
        page.goto("https://www.udemy.com/topic/python/",
                  wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)

        # Dismiss popups / cookie banners
        for sel in ["button:has-text('Accept')", "button:has-text('Agree')",
                     "button[data-purpose='accept-cookie']",
                     "button:has-text('Dismiss')", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load more courses
        for _ in range(8):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract courses...")

        # Strategy 1: parse body text for course patterns
        # Pattern: Title line → description with "Rating: X.X out of 5" →
        #          "Instructor:" → name → "Rating:" → number → "(count)" → price
        seen = set()
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]

        i = 0
        while i < len(lines) and len(courses) < MAX_RESULTS:
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
        if len(courses) < MAX_RESULTS:
            i = 0
            while i < len(lines) and len(courses) < MAX_RESULTS:
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
            for h3 in h3s:
                if len(courses) >= MAX_RESULTS:
                    break
                try:
                    text = h3.inner_text(timeout=1500).strip()
                    if len(text) > 10 and "Privacy" not in text and "Google" not in text:
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
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return courses


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
