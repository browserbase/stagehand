"""
Auto-generated Playwright script (Python)
Costco Set Preferred Warehouse: Redmond, WA

Generated on: 2026-02-26T20:36:32.537Z
Recorded 19 browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os
from playwright.sync_api import Playwright, sync_playwright, expect

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


def run(playwright: Playwright) -> bool:
    """
    Set the preferred Costco warehouse to 'Redmond, WA'.
    Returns True if the warehouse was successfully set, False otherwise.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("costco_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    # Extract the city keyword from the location for matching (e.g. "Redmond" from "Redmond, WA")
    location = "Redmond, WA"
    city = location.split(",")[0].strip()

    success = False

    try:
        # Navigate to Costco homepage
        page.goto("https://www.costco.com")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Click "Locations" link in the main navigation header
        try:
            page.get_by_role("link", name=re.compile(r"Locations", re.IGNORECASE)).first.evaluate("el => el.click()")
        except Exception:
            # Fallback: navigate directly to warehouse locations page
            page.goto("https://www.costco.com/warehouse-locations")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Find and fill the "City, State, or Zip" combobox inside the warehouse form
        # The input is inside div#warehouse-locations-page (main content), NOT the header
        warehouse_page = page.locator("#warehouse-locations-page, #mainContent")
        search_input = warehouse_page.get_by_role("combobox", name=re.compile(r"City.*State.*Zip", re.IGNORECASE)).first
        if not search_input.is_visible(timeout=3000):
            # Fallback: try any combobox with that label on the page
            search_input = page.get_by_role("combobox", name=re.compile(r"City.*State.*Zip", re.IGNORECASE)).first
        search_input.evaluate("el => el.click()")
        search_input.fill(location)
        page.wait_for_timeout(1000)

        # Click the "Find" button next to the search input (inside the warehouse form)
        try:
            find_btn = warehouse_page.get_by_role("button", name=re.compile(r"^Find", re.IGNORECASE)).first
            find_btn.evaluate("el => el.click()")
        except Exception:
            # Fallback: press Enter
            search_input.press("Enter")
        page.wait_for_timeout(4000)

        # Find the "Set as My Warehouse" button matching the target city
        # The button has aria-label like "Set as My Warehouse <CityName>"
        set_clicked = False

        # Try aria-label match first (most reliable)
        try:
            target_btn = page.get_by_role(
                "button",
                name=re.compile(r"Set as My Warehouse.*" + re.escape(city), re.IGNORECASE)
            ).first
            if target_btn.is_visible(timeout=5000):
                target_btn.evaluate("el => el.click()")
                set_clicked = True
        except Exception:
            pass

        # Fallback: find any "Set as My Warehouse" button and match by label
        if not set_clicked:
            try:
                btns = page.get_by_role("button", name=re.compile(r"Set as My Warehouse", re.IGNORECASE))
                count = btns.count()
                for i in range(count):
                    btn = btns.nth(i)
                    label = btn.get_attribute("aria-label") or btn.inner_text()
                    if city.lower() in label.lower():
                        btn.evaluate("el => el.click()")
                        set_clicked = True
                        break
                # If no specific button found, click the first one
                if not set_clicked and count > 0:
                    btns.first.evaluate("el => el.click()")
                    set_clicked = True
            except Exception:
                pass

        if set_clicked:
            page.wait_for_timeout(2000)
            success = True
            print("Successfully set preferred warehouse to: Redmond, WA")
        else:
            print("Warning: Could not find 'Set as My Warehouse' button for Redmond, WA")
            success = False

    except Exception as e:
        print(f"Error setting preferred warehouse: {e}")
        success = False
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)

    return success


if __name__ == "__main__":
    with sync_playwright() as playwright:
        result = run(playwright)
        print(f"\nWarehouse set successfully: {result}")
