"""
Auto-generated Playwright script (Python)
Google Maps Driving Directions: Bellevue Square → Redmond Town Center

Generated on: 2026-02-23T23:17:23.491Z
Recorded 23 browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os
from playwright.sync_api import Playwright, sync_playwright, expect


def run(playwright: Playwright) -> None:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
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
            "--start-maximized",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()

    # Navigate to https://www.google.com/maps
    page.goto("https://www.google.com/maps")
    page.wait_for_load_state("domcontentloaded")

    # Wait for Google Maps to fully render
    page.wait_for_timeout(3000)

    # Interface discovery analysis
    # AI extraction: Analyze the current Google Maps interface
    # Results: {"availableOptions":["Search","Directions","Set location","Delete","More from recent history","Restaurants","Hotels","Things to do","Museums","Transit","Pharmacies","ATMs","Menu","Saved","Recents","4 places Redmond & Bellevue","10 places Anchorage","Get app","Google apps","Show Your Location","Zoom in","Zoom out","Browse Street View images","Show imagery","Layers","United States","Terms","Privacy","Send Product Feedback","2000 ft"],"directionsRelated":["Directions"],"searchFeatures":["Search Google Maps","Search"],"otherControls":["Add your business","Learn more","Dismiss","Heavy traffic in this area","Slower than usual","Redmond weather","Reply to reviews, manage your business info, post offers and more!","Imagery ©2026 , Map data ©2026 Google"]}

    # Dynamic strategy planning based on interface discovery
    # AI extraction: Plan strategy for getting directions
    # Results: {"recommendedApproach":"Use the 'Directions' button to initiate the process of getting driving directions.","firstAction":"Click the 'Directions' button.","expectedWorkflow":["Click the 'Directions' button.","Enter 'Bellevue Square, Bellevue, WA' as the starting point.","Enter 'Redmond Town Center, Redmond, WA' as the destination.","Confirm the route and review the suggested directions."],"alternativesIfFailed":["Use the 'Search' button to locate 'Bellevue Square, Bellevue, WA' and 'Redmond Town Center, Redmond, WA' individually, then look for a 'Get Directions' option.","Manually pan the map to locate both places and use the context menu to find directions between them.","Search for driving directions using another mapping tool or application."]}

    # Execute first planned action
    # Stagehand AI action: Click the 'Directions' button.
    # Observed: button: Directions
    # ARIA: role="button", label="Directions"
    page.get_by_role("button", name=re.compile(r"Directions", re.IGNORECASE)).click()

    # Wait after: Execute first planned action
    page.wait_for_timeout(2000)

    # Verify that UI changed as expected after first action
    # AI extraction: Check interface state after first action
    # Results: {"newInterface":"Directions interface with travel mode options, starting point and destination inputs, and recently viewed places.","availableInputs":["Choose starting point, or click on the map...","Choose destination...","Search","Reverse starting point and destination"],"nextApproach":"Set the starting point and destination, select a travel mode, and review the suggested routes."}

    # Click starting location field first
    # Stagehand AI action: click on the starting point input field
    # Observed: textbox: Choose starting point, or click on the map...
    # ARIA: role="textbox", label="Choose starting point, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"starting point", re.IGNORECASE)).click()

    # Wait after: Click starting location field first
    page.wait_for_timeout(500)

    # Enter starting location: Bellevue Square, Bellevue, WA
    # Stagehand AI action: Enter 'Bellevue Square, Bellevue, WA' in the starting location field
    # Observed: Textbox for entering the starting location
    # ARIA: role="textbox", label="Choose starting point, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"starting point", re.IGNORECASE)).fill("Bellevue Square, Bellevue, WA")

    # Wait after: Enter starting location: Bellevue Square, Bellevue, WA
    page.wait_for_timeout(1000)

    # Click destination field first
    # Stagehand AI action: click on the destination input field
    # Observed: textbox for choosing the destination, labeled 'Choose destination, or click on the map...'
    # ARIA: role="textbox", label="Choose destination, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"destination", re.IGNORECASE)).click()

    # Wait after: Click destination field first
    page.wait_for_timeout(500)

    # Enter destination: Redmond Town Center, Redmond, WA
    # Stagehand AI action: Enter 'Redmond Town Center, Redmond, WA' in the destination field
    # Observed: textbox for entering the destination field
    # ARIA: role="textbox", label="Choose destination, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"destination", re.IGNORECASE)).fill("Redmond Town Center, Redmond, WA")

    # Wait after: Enter destination: Redmond Town Center, Redmond, WA
    page.wait_for_timeout(1000)

    # Search for directions using Enter key
    # Stagehand AI action: Press Enter to search for directions
    # Observed: Search button to initiate the search for directions
    # Using corrected searchbox ID for reliability
    # Scoped to #directions-searchbox-1 (3 elements share this role+label)
    # ARIA: role="button", label="Search"
    page.locator("#directions-searchbox-1").get_by_role("button", name=re.compile(r"Search", re.IGNORECASE)).press("Enter")

    # Wait after: Search for directions using Enter key
    page.wait_for_timeout(5000)

    # Check if route search was successful
    # AI extraction: Verify that directions are displayed
    # Results: {"directionsVisible":true,"routeInfo":"Driving 18 min 7.9 miles via WA-520 E Fastest route, despite the usual traffic\nDriving 18 min 9.9 miles via 92nd Ave NE and WA-520 E\nDriving 22 min 8.8 miles via WA-520 E and 148th Ave NE Some traffic, as usual","needsAction":""}

    # Final extraction of route details
    # AI extraction: Extract complete driving directions information
    # Results: {"distance":"7.9 miles","duration":"18 min","route":"WA-520 E","via":"Fastest route, despite the usual traffic","success":true}

    # Find the element displaying travel time/duration
    # Observe action: locate the travel time or duration element that shows how long the trip will take
    # Description: Find the element displaying travel time/duration
    # Locating element: StaticText element showing the travel time for Driving mode: 18 min
    # Scoped to ancestor [aria-label="Google Maps"]
    # Dynamic text with 7 regex matches, falling back to xpath-tail
    travel_time_element = page.get_by_label(re.compile(r"Google Maps", re.IGNORECASE)).locator("xpath=./div[9]/div[3]/div[1]/div[2]/div[1]/div[1]/div[1]/div[1]/div[1]/div[2]/button[1]/div[2]")
    travel_time_text = travel_time_element.text_content()
    print(f"Travel Time: {travel_time_text}")

    # Find the element displaying total distance
    # Observe action: locate the distance element that shows the total driving distance
    # Description: Find the element displaying total distance
    # Locating element: StaticText element displaying the total driving distance of 7.9 miles for the fastest route.
    # Scoped to ancestor [role="main"][aria-label="Directions"]
    # Dynamic text "7.9 miles" → structural regex (3 matches in scope, using .first)
    distance_element = page.get_by_role("main", name=re.compile(r"Directions", re.IGNORECASE)).get_by_text(re.compile(r"^\d+\.\d+\s*miles$")).first
    distance_text = distance_element.text_content()
    print(f"Distance: {distance_text}")

    # Get the actual values and element location info for travel time and distance
    # AI extraction: Extract travel time and distance values from their elements
    # Results: {"travelTime":"18 min","distance":"7.9 miles","travelTimeElementInfo":"[4-3188] StaticText: 18 min","distanceElementInfo":"[4-3189] StaticText: 7.9 miles"}

    # ---------------------
    # Cleanup
    # ---------------------
    context.close()


with sync_playwright() as playwright:
    run(playwright)
