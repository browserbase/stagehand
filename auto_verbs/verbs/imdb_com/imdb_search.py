"""
IMDB – Christopher Nolan Top 5 Rated Films
Generated: 2026-03-01T06:16:12.187Z
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY = "Christopher Nolan"
MAX_RESULTS = 5

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("imdb_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        print("STEP 1: Navigate to IMDB and search for Christopher Nolan...")
        page.goto("https://www.imdb.com/find/?q=Christopher+Nolan&s=nm", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        print("STEP 2: Click on Christopher Nolan's page...")
        nolan_link = page.locator("a:has-text('Christopher Nolan')").first
        nolan_link.evaluate("el => el.click()")
        page.wait_for_timeout(3000)

        print("STEP 3: Extract filmography...")
        # IMDB person page has alternating lines:
        #   Title
        #   Rating (e.g. "8.7")
        #   Role (e.g. "Director")
        #   Year (e.g. "2014")
        # We scan for this pattern: title → rating → skip → year
        body_text = page.inner_text("body")
        lines = [l.strip() for l in body_text.splitlines()]

        film_entries = []
        seen = set()
        i = 0
        while i < len(lines) - 3:
            line = lines[i]
            # A title line: non-empty, 3-100 chars, starts with letter
            if (line and 3 <= len(line) <= 100
                    and line[0].isalpha()
                    and not re.match(r'^(Menu|All|EN|Sign|Watch|Sponsor|Best known|More at|Photo|IMDb)', line)):
                # Next non-empty line should be a rating like "8.7"
                rating_line = lines[i + 1].strip() if i + 1 < len(lines) else ""
                rating_match = re.match(r'^(\d\.\d)$', rating_line)
                if rating_match:
                    rating = rating_match.group(1)
                    r_float = float(rating)
                    # Look for a year within the next 3 lines
                    year = ""
                    for j in range(i + 2, min(i + 5, len(lines))):
                        year_match = re.match(r'^((?:19|20)\d{2})$', lines[j].strip())
                        if year_match:
                            year = year_match.group(1)
                            break
                    if year and r_float >= 1.0:
                        key = line.lower()
                        if key not in seen:
                            seen.add(key)
                            film_entries.append({
                                "title": line,
                                "year": year,
                                "rating": rating,
                                "rating_float": r_float,
                            })
                        i = j + 1
                        continue
            i += 1

        # Sort by rating descending, take top 5
        film_entries.sort(key=lambda x: x["rating_float"], reverse=True)
        results = [{"title": f["title"], "year": f["year"], "rating": f["rating"]}
                   for f in film_entries[:MAX_RESULTS]]

        if not results:
            print("   ❌ ERROR: Extraction failed — no films found from the page.")
            return []

        print(f"\nDONE – {len(results)} films:")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['title']} ({r['year']}) – Rating: {r['rating']}")

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
