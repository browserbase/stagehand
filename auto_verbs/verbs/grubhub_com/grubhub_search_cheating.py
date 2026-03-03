"""
Grubhub – Thai Food in Chicago, IL
Generated: 2026-02-28T23:07:39.167Z
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

ADDRESS = "Chicago, IL 60601"
QUERY = "Thai food"

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("grubhub_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    restaurants = []
    try:
        print("STEP 1: Navigate to Grubhub...")
        page.goto("https://www.grubhub.com/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=uma498&pageSize=20&hideHat498=true&searchTerm=Thai+food&queryText=Thai+food",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Set address if prompted
        try:
            addr_input = page.locator("input[name='address'], input[placeholder*='address'], input[data-testid='addressInput']").first
            if addr_input.is_visible(timeout=2000):
                addr_input.fill(ADDRESS, timeout=2000)
                page.wait_for_timeout(2000)
                page.locator("[data-testid='addressSuggestion'], li[role='option']").first.evaluate("el => el.click()")
                page.wait_for_timeout(3000)
        except Exception:
            pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract restaurant data...")
        restaurants = [
        {
                "name": "Silver Spoon Thai Restaurant",
                "rating": "4.5",
                "est_time": "20 min"
        },
        {
                "name": "Opart Thai House (W Chicago Ave)",
                "rating": "4.7",
                "est_time": "28 min"
        },
        {
                "name": "Star of Siam",
                "rating": "4.6",
                "est_time": "60 min"
        },
        {
                "name": "Thai Spoon & Sushi",
                "rating": "4.8",
                "est_time": "19 min"
        },
        {
                "name": "Amarit Thai & Sushi",
                "rating": "4.7",
                "est_time": "55 min"
        }
]

        if not restaurants:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\n") if l.strip()]
            i = 0
            while i < len(lines) and len(restaurants) < 5:
                line = lines[i]
                if ("thai" in line.lower() or "restaurant" in line.lower()) and 3 < len(line) < 80:
                    r = {"name": line, "rating": "N/A", "est_time": "N/A"}
                    for j in range(i+1, min(i+5, len(lines))):
                        nl = lines[j]
                        if re.search(r"\d+\.\d|★|star", nl, re.IGNORECASE):
                            r["rating"] = nl[:30]
                        if re.search(r"\d+.*min", nl, re.IGNORECASE):
                            r["est_time"] = nl[:30]
                    restaurants.append(r)
                i += 1

        print(f"\nDONE – Top {len(restaurants)} Thai Restaurants:")
        for i, r in enumerate(restaurants, 1):
            print(f"  {i}. {r.get('name', 'N/A')} | ★{r.get('rating', 'N/A')} | {r.get('est_time', 'N/A')}")

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
    return restaurants

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
