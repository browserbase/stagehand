"""
USPS – Package Tracking
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

TRACKING_NUMBER = "9400111899223456789012"


def run(playwright: Playwright) -> dict:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("usps_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"status": "", "last_update": "", "expected_delivery": "", "location": ""}
    try:
        print("STEP 1: Navigate to USPS tracking page...")
        page.goto(
            f"https://tools.usps.com/go/TrackConfirmAction?tLabels={TRACKING_NUMBER}",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(6000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler",
                     "[aria-label='Close']", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        page.wait_for_timeout(3000)

        print("STEP 2: Extract tracking information...")

        # Strategy 1: known USPS selectors
        selector_map = [
            (".tb-status, .delivery_status, .tracking-status, .tb-status-detail", "status"),
            (".tb-date, .tracking-date, .tb-date-detail", "last_update"),
            (".expected-delivery, .tb-expected-delivery, .expected_delivery", "expected_delivery"),
            (".tb-location, .tracking-location, .tb-location-detail", "location"),
        ]
        for sel, key in selector_map:
            try:
                el = page.locator(sel).first
                val = el.inner_text(timeout=2000).strip()
                if val:
                    result[key] = val
            except Exception:
                pass

        # Strategy 2: banner / status heading
        if not result["status"]:
            for sel in [".banner-content h2", ".delivery-status h2", ".tb-step--current",
                        "[class*='StatusBanner'] h2", "[class*='status-banner']",
                        ".track-bar-container .tracking-progress-bar-status"]:
                try:
                    el = page.locator(sel).first
                    val = el.inner_text(timeout=1500).strip()
                    if val:
                        result["status"] = val
                        break
                except Exception:
                    continue

        # Strategy 3: body text parsing
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]

        if not result["status"]:
            for pattern in [
                r"(?:Status|Tracking Status|Current Status)[:\s]*([^\n]+)",
                r"(Delivered|In Transit|Out for Delivery|Pre-Shipment|Arrived at .+|Departed .+)",
                r"(Your item .+? delivered)",
            ]:
                m = re.search(pattern, body, re.IGNORECASE)
                if m:
                    result["status"] = m.group(1).strip()
                    break

        if not result["expected_delivery"]:
            for pattern in [
                r"(?:Expected Delivery|Expected|Scheduled Delivery)[:\s]*([\w, ]+\d{4})",
                r"(?:Expected Delivery|Expected|Delivery)[:\s]*(\w+,?\s+\w+\s+\d+)",
            ]:
                m = re.search(pattern, body, re.IGNORECASE)
                if m:
                    result["expected_delivery"] = m.group(1).strip()
                    break

        if not result["location"]:
            for pattern in [
                r"(?:Location|Last Location|Current Location)[:\s]+([A-Z][a-z]+[,\s]+[A-Z]{2}\s+\d{5})",
                r"(?:Location|Last Location)[:\s]+([A-Za-z ]+,\s*[A-Z]{2})",
            ]:
                m = re.search(pattern, body)
                if m:
                    result["location"] = m.group(1).strip()
                    break

        if not result["last_update"]:
            # Look for date patterns near status info
            date_pat = r"(\w+\s+\d{1,2},?\s+\d{4},?\s+\d{1,2}:\d{2}\s*(?:am|pm)?)"
            m = re.search(date_pat, body, re.IGNORECASE)
            if m:
                result["last_update"] = m.group(1).strip()

        # Check for "not found" type messages
        not_avail_phrases = [
            "tracking not available", "status not available", "not found",
            "no record", "couldn't find", "not recognized",
            "tracking is not available",
        ]
        body_lower = body.lower()
        no_info = any(kw in body_lower for kw in not_avail_phrases)
        if no_info and not result["status"]:
            result["status"] = "Tracking Not Available"
            # Look for explanation text
            for ln in lines:
                if "tracking is not available" in ln.lower() or "this may be" in ln.lower():
                    result["status"] = ln[:200]
                    break

        has_data = any(result[k] for k in result)
        if not has_data:
            print("❌ ERROR: Could not extract tracking info.")

        print(f"\nDONE – Tracking Result for {TRACKING_NUMBER}:")
        print(f"  Status:            {result['status'] or 'N/A'}")
        print(f"  Last Update:       {result['last_update'] or 'N/A'}")
        print(f"  Expected Delivery: {result['expected_delivery'] or 'N/A'}")
        print(f"  Location:          {result['location'] or 'N/A'}")

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
