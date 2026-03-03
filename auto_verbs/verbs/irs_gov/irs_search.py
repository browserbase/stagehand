"""
IRS.gov – Popular Forms & Publications
Extract up to 10 popular IRS forms with form number and URL.
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 10


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="irs_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    forms = []
    try:
        print("STEP 1: Navigate to IRS Forms & Instructions page...")
        page.goto(
            "https://www.irs.gov/forms-instructions",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(4000)

        # Dismiss any popups
        for sel in ["button:has-text('Accept')", "#close-button", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)

        print("STEP 2: Extract popular forms...")

        # Strategy 1: links containing "Form" text with IRS URLs
        form_links = page.locator("a[href*='/forms-pubs/'], a[href*='/pub/irs-pdf/']").all()
        seen = set()
        for link in form_links:
            if len(forms) >= MAX_RESULTS:
                break
            try:
                text = link.inner_text(timeout=1500).strip()
                href = link.get_attribute("href") or ""
                # Filter for actual form references
                if re.match(r'^(Form|Schedule|Pub)', text) and len(text) < 120:
                    key = text.lower()
                    if key not in seen:
                        seen.add(key)
                        full_url = href if href.startswith("http") else f"https://www.irs.gov{href}"
                        forms.append({"form": text, "url": full_url})
            except Exception:
                continue

        # Strategy 2: body text — look for form numbers
        if not forms:
            print("   Strategy 1 found 0 — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            for ln in lines:
                if len(forms) >= MAX_RESULTS:
                    break
                m = re.match(r'^(Form\s+[\w-]+(?:\s*\(.*?\))?)', ln)
                if m and len(ln) < 120:
                    form_name = m.group(1).strip()
                    if form_name.lower() not in seen:
                        seen.add(form_name.lower())
                        forms.append({"form": form_name, "url": "N/A"})

        if not forms:
            print("❌ ERROR: Extraction failed — no forms found from the page.")

        print(f"\nDONE – {len(forms)} Popular IRS Forms:")
        for i, f in enumerate(forms, 1):
            print(f"  {i}. {f['form']}")
            print(f"     URL: {f['url']}")

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
    return forms


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
