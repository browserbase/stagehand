"""
Indeed – Search "Data Analyst" jobs in "Remote", sort by Date
Extract top 5 job postings with title, company, salary, posted date.
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="indeed_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    jobs = []
    try:
        print("STEP 1: Search Indeed for Data Analyst Remote jobs, sorted by date...")
        # sort=date for newest first, l=Remote
        page.goto(
            "https://www.indeed.com/jobs?q=Data+Analyst&l=Remote&sort=date",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(5000)

        # Dismiss popups
        for sel in [
            "button:has-text('Accept')",
            "button:has-text('Accept all')",
            "#onetrust-accept-btn-handler",
            "[aria-label='close']",
            "button.icl-CloseButton",
        ]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract job postings...")

        # Strategy 1: job card elements
        cards = page.locator(".resultContent").all()
        if not cards:
            cards = page.locator(".job_seen_beacon").all()
        if not cards:
            cards = page.locator("[data-jk]").all()
        print(f"   Found {len(cards)} job card elements")

        seen_titles = set()
        for card in cards:
            if len(jobs) >= MAX_RESULTS:
                break
            try:
                txt = card.inner_text(timeout=3000)
                lines = [l.strip() for l in txt.splitlines() if l.strip()]
                if not lines:
                    continue

                title = ""
                company = ""
                salary = "N/A"
                posted = "N/A"

                # Title is typically the first line or inside h2/a
                try:
                    title = card.locator("h2 a span, h2 span, .jobTitle span").first.inner_text(timeout=1500).strip()
                except Exception:
                    title = lines[0] if lines else ""

                if not title or len(title) < 4:
                    continue
                if title.lower() in seen_titles:
                    continue
                seen_titles.add(title.lower())

                # Company name
                try:
                    company = card.locator("[data-testid='company-name'], .companyName, .company").first.inner_text(timeout=1500).strip()
                except Exception:
                    for ln in lines[1:4]:
                        if len(ln) > 2 and not ln.startswith("$") and not re.match(r'^\d', ln):
                            company = ln
                            break

                # Salary
                for ln in lines:
                    if "$" in ln and re.search(r'\$[\d,]+', ln):
                        salary = ln[:80]
                        break

                # Posted date — look for "Posted X days ago", "Just posted", "Active X days"
                try:
                    date_el = card.locator("[data-testid='myJobsStateDate'], .date, .result-footer .visually-hidden").first
                    posted = date_el.inner_text(timeout=1000).strip()[:40]
                except Exception:
                    for ln in lines:
                        if re.search(r'(just posted|posted\s+\d|today|\d+\s*day|active\s+\d|ago)', ln, re.IGNORECASE):
                            posted = ln[:40]
                            break

                if title and len(title) > 3:
                    jobs.append({
                        "title": title,
                        "company": company or "N/A",
                        "salary": salary,
                        "posted": posted,
                    })
            except Exception:
                continue

        # Strategy 2: body text fallback
        if not jobs:
            print("   Strategy 1 found 0 — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            i = 0
            while i < len(lines) and len(jobs) < MAX_RESULTS:
                ln = lines[i]
                # Job titles often have "Analyst" or "Data" in them
                if ("analyst" in ln.lower() or "data" in ln.lower()) and 5 < len(ln) < 100:
                    company = lines[i + 1] if i + 1 < len(lines) and len(lines[i + 1]) < 60 else "N/A"
                    salary = "N/A"
                    posted = "N/A"
                    for j in range(i + 1, min(i + 8, len(lines))):
                        if "$" in lines[j] and salary == "N/A":
                            salary = lines[j][:80]
                        if re.search(r'(just posted|today|\d+\s*day|ago)', lines[j], re.IGNORECASE) and posted == "N/A":
                            posted = lines[j][:40]
                    jobs.append({"title": ln, "company": company, "salary": salary, "posted": posted})
                    i += 5
                    continue
                i += 1

        if not jobs:
            print("❌ ERROR: Extraction failed — no jobs found from the page.")

        print(f"\nDONE – Top {len(jobs)} Data Analyst Jobs (Remote, by Date):")
        for i, j in enumerate(jobs, 1):
            print(f"  {i}. {j['title']} | {j['company']} | Salary: {j['salary']} | Posted: {j['posted']}")

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
    return jobs


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
