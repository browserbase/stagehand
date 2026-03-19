"""
Google Maps – Create Saved List
Pure Playwright – no AI. Requires Google login in Chrome profile.
"""

import os
from dataclasses import dataclass
from typing import List
from playwright.sync_api import Playwright, sync_playwright


@dataclass(frozen=True)
class CreateListRequest:
    list_name: str      # name for the new saved list
    places: List[str]   # place names to add to the list


@dataclass(frozen=True)
class CreateListResult:
    list_name: str          # name of the created list
    places_added: List[str] # places that were successfully added
    success: bool           # True if all places were added


# Create a new saved list on Google Maps and add the specified places to it.
# Navigates to maps.google.com, clicks Saved → New list, renames the list,
# then searches for each place using the built-in "Add a place" input and
# selects the first suggestion from the dropdown.
# Requires the user to be logged into Google in the Chrome profile.
def create_saved_list(playwright: Playwright, request: CreateListRequest) -> CreateListResult:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default"
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport=None,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    places_added = []

    try:
        print(f"Loading Google Maps ...")
        page.goto("https://www.google.com/maps", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        print(f"  Loaded: {page.url}")

        # Dismiss consent popups
        for sel in ["button:has-text('Accept all')", "button:has-text('Reject all')", "button:has-text('I agree')"]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=200):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(300)
            except Exception:
                pass

        # Step 1: Click "Saved" in the sidebar
        print("\nSTEP 1: Click Saved ...")
        saved_btn = page.locator("button:has-text('Saved')").first
        saved_btn.wait_for(state="visible", timeout=10000)
        saved_btn.evaluate("el => el.click()")
        page.wait_for_timeout(2000)
        print("  Clicked Saved")

        # Step 2: Create new list (clicking "New list" creates it immediately as "Untitled list")
        print(f"\nSTEP 2: Create list '{request.list_name}' ...")
        new_list_btn = page.locator("button:has-text('New list')").first
        new_list_btn.wait_for(state="visible", timeout=10000)
        new_list_btn.evaluate("el => el.click()")
        page.wait_for_timeout(3000)

        # Dismiss any "Unavailable" dialog that may appear
        try:
            dialog = page.locator("[role='dialog']")
            if dialog.is_visible(timeout=500):
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)
        except Exception:
            pass

        # Rename the list: clear the inline name input and type the new name
        name_input = page.locator("input.Tpthec.fontTitleLarge").first
        name_input.wait_for(state="visible", timeout=5000)
        name_input.click()
        name_input.fill("")
        name_input.fill(request.list_name)
        page.wait_for_timeout(500)
        # Click away to confirm the name
        page.locator("h2.HUaNde").first.click()
        page.wait_for_timeout(500)
        print(f"  Renamed list to '{request.list_name}'")

        # Step 3: Add each place using the built-in "Search for a place to add" input
        for i, place_name in enumerate(request.places, 1):
            print(f"\nSTEP {2 + i}: Add '{place_name}' ...")

            # Click "Add a place" button if the search input is not visible
            add_place_input = page.locator("input[aria-label='Search for a place to add']").first
            try:
                if not add_place_input.is_visible(timeout=1000):
                    add_btn = page.locator("button[aria-label='Add a place']").first
                    add_btn.evaluate("el => el.click()")
                    page.wait_for_timeout(1000)
            except Exception:
                add_btn = page.locator("button[aria-label='Add a place']").first
                add_btn.evaluate("el => el.click()")
                page.wait_for_timeout(1000)

            # Type the place name in the search input
            add_place_input = page.locator("input[aria-label='Search for a place to add']").first
            add_place_input.click()
            add_place_input.fill(place_name)
            page.wait_for_timeout(2000)

            # Select the first suggestion from the dropdown grid
            suggestion = page.locator("[role='grid'][aria-label='Suggestions'] [role='row'][data-suggestion-index='0']").first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
            page.wait_for_timeout(1500)

            places_added.append(place_name)
            print(f"  Added '{place_name}'")

        # Click "Done" to finish
        done_btn = page.locator("button:has-text('Done')").first
        if done_btn.is_visible(timeout=2000):
            done_btn.evaluate("el => el.click()")
            page.wait_for_timeout(1000)
        print("\n  Clicked Done")

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            context.close()
        except Exception:
            pass

    success = len(places_added) == len(request.places)
    return CreateListResult(
        list_name=request.list_name,
        places_added=places_added,
        success=success,
    )


def test_create_list():
    request = CreateListRequest(
        list_name="urbana champaign dealerships",
        places=["Napleton's Auto Park of Urbana","Sam Leman Chevrolet of Champaign","Champaign Urbana Auto Park"],
    )
    with sync_playwright() as pw:
        result = create_saved_list(pw, request)

    print(f"\n{'='*60}")
    print(f"  List: {result.list_name}")
    print(f"  Places added: {len(result.places_added)}/{len(request.places)}")
    print(f"  Success: {result.success}")
    print(f"{'='*60}")
    for p in result.places_added:
        print(f"  ✅ {p}")
    return result


if __name__ == "__main__":
    test_create_list()
