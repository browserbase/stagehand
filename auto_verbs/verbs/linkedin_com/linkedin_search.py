"""
LinkedIn – Software Engineer jobs in Seattle, WA (Past week)
Pure Playwright – no AI.
NOTE: Uses guest/public job search view. Some features may require login.
"""
from datetime import date, timedelta
import re, os, sys, traceback, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

from dataclasses import dataclass


@dataclass(frozen=True)
class LinkedInSearchRequest:
    keywords: str
    location: str
    max_results: int


@dataclass(frozen=True)
class LinkedInJob:
    title: str
    company: str
    location: str
    posted_date: str


@dataclass(frozen=True)
class LinkedInSearchResult:
    keywords: str
    location: str
    jobs: list[LinkedInJob]


# Searches LinkedIn for public job postings matching keywords and location, returning up to max_results listings.
def search_linkedin_jobs(
    playwright,
    request: LinkedInSearchRequest,
) -> LinkedInSearchResult:
    keywords = request.keywords
    location = request.location
    max_results = request.max_results
    raw_results = []
    port = get_free_port()
    profile_dir = get_temp_profile_dir("linkedin_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    raw_results = []
    try:
        # f_TPR=r604800 = Past week filter
        print("STEP 1: Navigate to LinkedIn job search...")
        url = ("https://www.linkedin.com/raw_results/search/?"
               "keywords=Software%20Engineer&location=Seattle%2C%20WA&f_TPR=r604800")
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # Check for auth wall
        current_url = page.url
        needs_login = "login" in current_url or "authwall" in current_url or "signup" in current_url
        if needs_login:
            print("   Auth wall detected — trying guest job search URL...")
            page.goto(
                "https://www.linkedin.com/raw_results/search?"
                "keywords=Software+Engineer&location=Seattle+WA&f_TPR=r604800&position=1&pageNum=0",
                wait_until="domcontentloaded", timeout=30000,
            )
            page.wait_for_timeout(8000)
            current_url = page.url
            needs_login = "login" in current_url or "authwall" in current_url

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Dismiss')",
                     "[aria-label='Dismiss']", "button:has-text('Reject')",
                     "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(400)
            except Exception:
                pass

        # Scroll to load raw_results
        for _ in range(6):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract job listings...")

        # ── Strategy 1: LinkedIn job card selectors (guest view) ──
        seen = set()
        card_sels = [
            ".base-card",
            ".job-search-card",
            ".raw_results-search-results__list-item",
            "li.result-card",
            "[class*='base-card']",
            "[data-entity-urn*='jobPosting']",
        ]
        for sel in card_sels:
            if len(raw_results) >= request.max_results:
                break
            try:
                cards = page.locator(sel).all()
                if not cards:
                    continue
                print(f"   Selector '{sel}' → {len(cards)} elements")
                for card in cards:
                    if len(raw_results) >= request.max_results:
                        break
                    try:
                        text = card.inner_text(timeout=2000).strip()
                        lines = [l.strip() for l in text.splitlines() if l.strip()]
                        if len(lines) < 3:
                            continue

                        # LinkedIn guest cards: [title, title_dup, company, location, posted]
                        title = lines[0]
                        # Skip duplicate title line
                        idx = 1
                        if idx < len(lines) and lines[idx] == title:
                            idx += 1
                        company = lines[idx] if idx < len(lines) else "N/A"
                        idx += 1
                        location = lines[idx] if idx < len(lines) else "N/A"
                        idx += 1
                        posted = "N/A"
                        # Remaining lines: look for posted date
                        for ln in lines[idx:]:
                            ll = ln.lower()
                            if re.search(r"\d+\s*(day|hour|week|month|min)", ll) or "just now" in ll or "today" in ll:
                                posted = ln[:40]
                                break

                        key = title.lower()
                        if key not in seen:
                            seen.add(key)
                            raw_results.append({
                                "title": title[:80],
                                "company": company[:60],
                                "location": location[:60],
                                "posted_date": posted,
                            })
                    except Exception:
                        continue
            except Exception:
                continue

        # ── Strategy 2: body text parsing ──
        if not raw_results:
            print("   Strategy 1 found 0 – trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]

            i = 0
            while i < len(lines) and len(raw_results) < request.max_results:
                ln = lines[i]
                ll = ln.lower()
                # Job title patterns — look for engineering-related keywords
                if (re.search(r"engineer|developer|software|sre|devops|architect|analyst|data\s+scientist", ll)
                    and len(ln) > 5 and len(ln) < 100
                    and not re.search(r"sign|log in|join|filter|search|sort|result|skill|show", ll)):
                    title = ln[:80]
                    company = lines[i + 1][:60] if i + 1 < len(lines) else "N/A"
                    location = lines[i + 2][:60] if i + 2 < len(lines) else "N/A"
                    posted = "N/A"
                    for j in range(i, min(i + 6, len(lines))):
                        cl = lines[j].lower()
                        if re.search(r"\d+\s*(day|hour|week|month)s?\s*ago|just now|today", cl):
                            posted = lines[j][:40]
                            break

                    key = title.lower()
                    if key not in seen:
                        seen.add(key)
                        raw_results.append({
                            "title": title,
                            "company": company,
                            "location": location,
                            "posted_date": posted,
                        })
                    i += 4  # skip parsed lines
                else:
                    i += 1

        if not raw_results:
            if needs_login:
                print("❌ ERROR: LinkedIn requires login to view job listings.")
            else:
                body_text = page.inner_text("body").strip()
                if not body_text:
                    print("❌ ERROR: Page body is empty — possible bot protection.")
                else:
                    print("❌ ERROR: Extraction failed — no raw_results found.")

        print(f"\nDONE – Top {len(raw_results)} Software Engineer Jobs in Seattle:")
        for i, j in enumerate(raw_results, 1):
            print(f"  {i}. {j['title']}")
            print(f"     Company: {j['company']}  |  Location: {j['location']}")
            print(f"     Posted: {j['posted_date']}")

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
    return LinkedInSearchResult(
        keywords=keywords,
        location=location,
        jobs=[LinkedInJob(title=r["title"], company=r["company"], location=r["location"], posted_date=r["posted_date"]) for r in raw_results],
    )


def test_linkedin_jobs() -> None:
    from playwright.sync_api import sync_playwright
    request = LinkedInSearchRequest(keywords="Software Engineer", location="Seattle, WA", max_results=5)
    with sync_playwright() as playwright:
        result = search_linkedin_jobs(playwright, request)
    assert result.keywords == request.keywords
    assert len(result.jobs) <= request.max_results
    print(f"\nTotal jobs found: {len(result.jobs)}")


if __name__ == "__main__":
    test_linkedin_jobs()
