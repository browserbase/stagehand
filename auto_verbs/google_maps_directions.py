"""
Auto-generated Playwright script (Python)
Google Maps Driving Directions: Bellevue Square → Redmond Town Center

Generated on: 2026-02-18T05:15:37.371Z
Recorded 18 browser interactions
"""

import re
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    browser = playwright.chromium.launch(headless=False, channel="chrome")
    context = browser.new_context(
        viewport={"width": 1280, "height": 720},
        user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    )
    page = context.new_page()

    # Navigate to https://www.google.com/maps
    page.goto("https://www.google.com/maps")
    page.wait_for_load_state("domcontentloaded")

    # Wait for Google Maps to fully render
    page.wait_for_timeout(2000)

    # Click the Directions button on Google Maps
    # Stagehand AI action: click the Directions button
    # Observed: The 'Directions' button in the Google Maps interface.
    # ARIA: role="button", label="Directions"
    page.get_by_role("button", name=re.compile(r"Directions", re.IGNORECASE)).click()

    # Wait after: Click the Directions button on Google Maps
    page.wait_for_timeout(1500)

    # Click the starting point input field
    # Stagehand AI action: click on the starting point input field
    # Observed: The input field for choosing the starting point.
    # ARIA: role="textbox", label="Choose starting point, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"starting point", re.IGNORECASE)).click()

    # Wait after: Click the starting point input field
    page.wait_for_timeout(500)

    # Type starting location: Bellevue Square, Bellevue, WA
    # Stagehand AI action: type 'Bellevue Square, Bellevue, WA' into the starting point input field
    # Observed: Textbox for entering the starting point
    # ARIA: role="textbox", label="Choose starting point, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"starting point", re.IGNORECASE)).fill("Bellevue Square, Bellevue, WA")

    # Wait after: Type starting location: Bellevue Square, Bellevue, WA
    page.wait_for_timeout(1000)

    # Click the destination input field
    # Stagehand AI action: click on the destination input field
    # Observed: The destination input field labeled 'Choose destination, or click on the map...'.
    # ARIA: role="textbox", label="Choose destination, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"destination", re.IGNORECASE)).click()

    # Wait after: Click the destination input field
    page.wait_for_timeout(500)

    # Type destination: Redmond Town Center, Redmond, WA
    # Stagehand AI action: type 'Redmond Town Center, Redmond, WA' into the destination input field
    # Observed: Destination input field for entering the location.
    # ARIA: role="textbox", label="Choose destination, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"destination", re.IGNORECASE)).fill("Redmond Town Center, Redmond, WA")

    # Wait after: Type destination: Redmond Town Center, Redmond, WA
    page.wait_for_timeout(1000)

    # Press Enter to search for directions
    # Stagehand AI action: press Enter to search for directions
    # Observed: The 'Search' button to initiate the search for directions.
    # Scoped to #directions-searchbox-0 (3 elements share this role+label)
    # ARIA: role="button", label="Search"
    page.locator("#directions-searchbox-0").get_by_role("button", name=re.compile(r"Search", re.IGNORECASE)).press("Enter")

    # Wait after: Press Enter to search for directions
    page.wait_for_timeout(5000)

    # Select driving mode
    # Stagehand AI action: click the driving mode button to select driving directions (the car icon)
    # Observed: The radio button for selecting driving directions, represented by a car icon.
    # ARIA: role="radio", label="Driving"
    page.get_by_role("radio", name=re.compile(r"Driving", re.IGNORECASE)).click()

    # Wait after: Select driving mode
    page.wait_for_timeout(3000)

    # Take screenshot: directions_result
    page.screenshot(path="directions_result.png")

    # Extracted: distance=7.9 miles, duration=15 min, route=WA-520 E
    # Text extracted via AI: Extracted: distance=7.9 miles, duration=15 min, route=WA-520 E

    # ---------------------
    # Cleanup
    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)
