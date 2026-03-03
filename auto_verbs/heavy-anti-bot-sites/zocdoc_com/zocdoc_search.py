"""
ZocDoc – Dentist search near San Francisco, CA
Generated: 2026-03-03T01:17:38.210Z
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("zocdoc_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    doctors = []
    try:
        print("STEP 1: Navigate to ZocDoc search...")
        url = "https://www.zocdoc.com/search?address=San%20Francisco%2C%20CA&dr_specialty=dentist&sort_type=highly_rated"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Got it')", "[aria-label='Close']", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract doctor data...")
        doctors = []

        if not doctors:
            cards = page.locator("[data-test='provider-card'], .sc-provider-card, .provider-card").all()
            for card in cards[:5]:
                try:
                    txt = card.inner_text(timeout=3000)
                    lines = [l.strip() for l in txt.split("\n") if l.strip()]
                    name = ""
                    specialty = ""
                    rating = ""
                    appt = ""
                    for ln in lines:
                        if re.search(r"^Dr\.", ln) or (re.search(r"^[A-Z]", ln) and "DDS" in ln):
                            name = ln[:60]
                        elif any(w in ln.lower() for w in ["dentist", "dds", "orthodont", "endodont", "oral"]):
                            specialty = ln[:40]
                        elif re.search(r"\d+\.\d+|★|star", ln, re.IGNORECASE):
                            rating = ln[:30]
                        elif re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d{1,2}/\d{1,2})", ln):
                            appt = ln[:50]
                    if name:
                        doctors.append({"name": name, "specialty": specialty or "Dentist", "rating": rating or "N/A", "earliest_appointment": appt or "N/A"})
                except Exception:
                    pass

        if not doctors:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\n") if l.strip()]
            for i, line in enumerate(lines):
                if re.search(r"^Dr\.|DDS|DMD", line) and len(line) < 80:
                    rating = ""
                    appt = ""
                    for j in range(i, min(i+8, len(lines))):
                        if re.search(r"\d+\.\d+|★", lines[j]):
                            rating = lines[j][:30]
                        if re.search(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d{1,2}/\d{1,2}|tomorrow|today)", lines[j], re.IGNORECASE):
                            appt = lines[j][:50]
                    doctors.append({"name": line[:60], "specialty": "Dentist", "rating": rating or "N/A", "earliest_appointment": appt or "N/A"})
                if len(doctors) >= 5:
                    break

        print(f"\nDONE – Top {len(doctors)} Dentists:")
        for i, d in enumerate(doctors, 1):
            print(f"  {i}. {d.get('name','N/A')} | {d.get('specialty','N/A')} | {d.get('rating','N/A')} | {d.get('earliest_appointment','N/A')}")

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
    return doctors

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
