"""
Google Maps – Driving Directions (Space Needle → Pike Place Market)
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

ORIGIN = "Space Needle, Seattle, WA"
DESTINATION = "Pike Place Market, Seattle, WA"


def run(playwright: Playwright) -> dict:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("maps_google_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"route": "", "time": "", "distance": "", "steps": []}
    try:
        print("STEP 1: Navigate to Google Maps directions...")
        url = "https://www.google.com/maps/dir/Space+Needle,+Seattle,+WA/Pike+Place+Market,+Seattle,+WA/"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('OK')",
                     "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Ensure driving mode is selected
        try:
            driving_btn = page.locator("[data-travel_mode='0'], [aria-label*='Driving']").first
            if driving_btn.is_visible(timeout=2000):
                driving_btn.evaluate("el => el.click()")
                page.wait_for_timeout(3000)
        except Exception:
            pass

        print("STEP 2: Extract route information...")

        # Strategy 1: known Google Maps selectors
        # Route summary
        for sel in ["#section-directions-trip-0 h1", "[data-trip-index='0'] h1",
                     ".directions-mode-group h1", ".trip-details h1"]:
            try:
                el = page.locator(sel).first
                val = el.inner_text(timeout=2000).strip()
                if val:
                    result["route"] = val
                    break
            except Exception:
                continue

        # Duration and distance from trip details
        for sel in ["#section-directions-trip-0", "[data-trip-index='0']",
                     ".directions-mode-group", "[class*='trip-summary']"]:
            try:
                el = page.locator(sel).first
                text = el.inner_text(timeout=2000)
                # duration: "7 min", "1 hr 5 min"
                m_time = re.search(r"(\d+\s*(?:hr|hour)s?\s*)?(\d+\s*min)", text)
                if m_time:
                    result["time"] = m_time.group(0).strip()
                # distance: "1.1 miles" or "2.3 km" (avoid matching 'min')
                m_dist = re.search(r"(\d+\.?\d*)\s*(miles|mi\b|km|kilometers)", text)
                if m_dist:
                    result["distance"] = m_dist.group(0).strip()
                break
            except Exception:
                continue

        # Strategy 2: body text parsing
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]

        if not result["time"]:
            m = re.search(r"(\d+\s*(?:hr|hour)s?\s+)?\d+\s*min", body)
            if m:
                result["time"] = m.group(0).strip()

        if not result["distance"]:
            m = re.search(r"(\d+\.?\d*)\s*(miles|mi\b|km)", body)
            if m:
                result["distance"] = m.group(0).strip()

        if not result["route"]:
            # Look for "via <road name>"
            m = re.search(r"via\s+(.+?)(?:\n|$)", body)
            if m:
                result["route"] = m.group(0).strip()

        # Extract turn-by-turn steps
        # Click on the first route to expand it and show steps
        try:
            for expand_sel in ["[data-trip-index='0']", ".trip-details-header",
                              "[class*='trip'] [class*='summary']",
                              "button[aria-label*='Details']",
                              "[class*='route-option']:first-child"]:
                try:
                    el = page.locator(expand_sel).first
                    if el.is_visible(timeout=1500):
                        el.evaluate("el => el.click()")
                        page.wait_for_timeout(3000)
                        break
                except Exception:
                    continue
        except Exception:
            pass

        # Look for step containers
        step_sels = [
            "[class*='directions-mode-step']",
            ".DdSteps div[class*='step']",
            "[data-step-index]",
        ]
        for sel in step_sels:
            try:
                step_els = page.locator(sel).all()
                if step_els:
                    for s_el in step_els:
                        text = s_el.inner_text(timeout=1500).strip()
                        first_line = text.splitlines()[0].strip() if text else ""
                        if first_line and len(first_line) > 5 and len(first_line) < 200:
                            result["steps"].append(first_line)
                    if result["steps"]:
                        break
            except Exception:
                continue

        # Fallback: parse steps from body text (re-read after possible click)
        if not result["steps"]:
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            step_pattern = re.compile(
                r"(Head\s+\w+|Turn\s+\w+|Keep\s+\w+|Take\s+\w+|Merge\s+\w+|Continue\s+\w+|Slight\s+\w+|Use\s+\w+|"
                r"Take the .+? exit|Enter .+|Exit .+|Drive .+|Walk .+).*",
                re.IGNORECASE,
            )
            for ln in lines:
                m = step_pattern.match(ln)
                if m and len(ln) < 200:
                    result["steps"].append(ln)

        # If still no steps, extract route alternatives as info
        if not result["steps"]:
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            route_info = []
            i = 0
            while i < len(lines):
                if re.match(r"^\d+\s*min$", lines[i]):
                    time_val = lines[i]
                    dist_val = lines[i + 1] if i + 1 < len(lines) else ""
                    via_val = lines[i + 2] if i + 2 < len(lines) else ""
                    if "mile" in dist_val.lower() or "km" in dist_val.lower():
                        route_info.append(f"{via_val} — {time_val}, {dist_val}")
                        i += 3
                        continue
                i += 1
            if route_info:
                result["steps"] = route_info

        has_data = result["time"] or result["distance"] or result["steps"]
        if not has_data:
            print("❌ ERROR: Could not extract directions.")

        print(f"\nDONE – Driving Directions:")
        print(f"  Route:    {result['route'] or 'N/A'}")
        print(f"  Time:     {result['time'] or 'N/A'}")
        print(f"  Distance: {result['distance'] or 'N/A'}")
        if result["steps"]:
            print(f"  Steps ({len(result['steps'])}):")
            for i, step in enumerate(result["steps"][:10], 1):
                print(f"    {i}. {step}")
        else:
            print("  Steps: N/A")

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
    return result


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
