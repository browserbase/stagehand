"""
Auto-generated Playwright script (Python)
Google Maps Driving Directions: Bellevue Square → Redmond Town Center

Generated on: 2026-02-21T01:10:27.513Z
Recorded 23 browser interactions
Note: This script was generated using AI-driven discovery patterns
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
    page.wait_for_timeout(3000)

    # Interface discovery analysis
    # AI extraction: Analyze the current Google Maps interface
    # Results: {"availableOptions":["Search","Directions","Restaurants","Hotels","Things to do","Museums","Transit","Pharmacies","ATMs","Next page","Menu","Saved","Recents","Get app","Google apps","Show Your Location","Zoom in","Zoom out","Browse Street View images","Show imagery","Layers","United States","Terms","Privacy","Send Product Feedback","2000 ft"],"directionsRelated":["Directions"],"searchFeatures":["Search Google Maps"],"otherControls":["Light traffic in this area Typical conditions","Imagery ©2026 , Map data ©2026 Google"]}

    # Dynamic strategy planning based on interface discovery
    # AI extraction: Plan strategy for getting directions
    # Results: {"recommendedApproach":"Use the 'Directions' button to initiate the process of getting driving directions.","firstAction":"Click the 'Directions' button.","expectedWorkflow":["Click the 'Directions' button.","Enter 'Bellevue Square, Bellevue, WA' as the starting point.","Enter 'Redmond Town Center, Redmond, WA' as the destination.","Confirm the route and review the driving directions provided."],"alternativesIfFailed":["Use the 'Search' button to look up 'Bellevue Square, Bellevue, WA' and 'Redmond Town Center, Redmond, WA' separately, then use the 'Directions' feature from one of the locations.","Manually pan the map to locate both places and use the 'Directions' button to set the route.","Consult another mapping service or application to get the driving directions."]}

    # Execute first planned action
    # Stagehand AI action: Click the 'Directions' button.
    # Observed: button: Directions
    # ARIA: role="button", label="Directions"
    page.get_by_role("button", name=re.compile(r"Directions", re.IGNORECASE)).click()

    # Wait after: Execute first planned action
    page.wait_for_timeout(2000)

    # Verify that UI changed as expected after first action
    # AI extraction: Check interface state after first action
    # Results: {"newInterface":"Directions interface with travel mode options and input fields for starting point and destination.","availableInputs":["Choose starting point, or click on the map...","Choose destination..."],"nextApproach":"Select a starting point and destination, then choose the preferred travel mode to get directions."}

    # Click starting location field first
    # Stagehand AI action: click on the starting point input field
    # Observed: textbox: Choose starting point, or click on the map...
    # ARIA: role="textbox", label="Choose starting point, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"starting point", re.IGNORECASE)).click()

    # Wait after: Click starting location field first
    page.wait_for_timeout(500)

    # Enter starting location: Bellevue Square, Bellevue, WA
    # Stagehand AI action: Enter 'Bellevue Square, Bellevue, WA' in the starting location field
    # Observed: textbox: Choose starting point, or click on the map...
    # ARIA: role="textbox", label="Choose starting point, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"starting point", re.IGNORECASE)).fill("Bellevue Square, Bellevue, WA")

    # Wait after: Enter starting location: Bellevue Square, Bellevue, WA
    page.wait_for_timeout(1000)

    # Click destination field first
    # Stagehand AI action: click on the destination input field
    # Observed: textbox for entering the destination, labeled as 'Choose destination, or click on the map...'
    # ARIA: role="textbox", label="Choose destination, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"destination", re.IGNORECASE)).click()

    # Wait after: Click destination field first
    page.wait_for_timeout(500)

    # Enter destination: Redmond Town Center, Redmond, WA
    # Stagehand AI action: Enter 'Redmond Town Center, Redmond, WA' in the destination field
    # Observed: textbox for entering the destination
    # ARIA: role="textbox", label="Choose destination, or click on the map..."
    page.get_by_role("textbox", name=re.compile(r"destination", re.IGNORECASE)).fill("Redmond Town Center, Redmond, WA")

    # Wait after: Enter destination: Redmond Town Center, Redmond, WA
    page.wait_for_timeout(1000)

    # Search for directions using Enter key
    # Stagehand AI action: Press Enter to search for directions
    # Observed: Search button to initiate the search for directions
    # Scoped to #directions-searchbox-1 (3 elements share this role+label)
    # ARIA: role="button", label="Search"
    page.locator("#directions-searchbox-1").get_by_role("button", name=re.compile(r"Search", re.IGNORECASE)).press("Enter")

    # Wait after: Search for directions using Enter key
    page.wait_for_timeout(5000)

    # Check if route search was successful
    # AI extraction: Verify that directions are displayed
    # Results: {"directionsVisible":true,"routeInfo":"Driving 19 min 9.9 miles via WA-520 E Fastest route now due to traffic conditions\nDriving 20 min 7.9 miles via NE 10th St and WA-520 E Some traffic, as usual\nTransit 35 min Warning 5:14 PM—5:49 PM Walk , then Light rail 2 Line","needsAction":""}

    # Final extraction of route details
    # AI extraction: Extract complete driving directions information
    # Results: {"distance":"9.9 miles","duration":"19 min","route":"WA-520 E","via":"Fastest route now due to traffic conditions","success":true}

    # Find the element displaying travel time/duration
    # Observe action: locate the travel time or duration element that shows how long the trip will take
    # Description: Find the element displaying travel time/duration
    # Locating element: StaticText element displaying the travel time for driving: 19 min
    # Scoped to ancestor [aria-label="Google Maps"]
    # Dynamic text with 7 regex matches, falling back to xpath-tail
    travel_time_element = page.get_by_label(re.compile(r"Google Maps", re.IGNORECASE)).locator("xpath=./div[9]/div[3]/div[1]/div[2]/div[1]/div[1]/div[1]/div[1]/div[1]/div[2]/button[1]/div[2]")
    travel_time_text = travel_time_element.text_content()
    print(f"Travel Time: {travel_time_text}")

    # Find the element displaying total distance
    # Observe action: locate the distance element that shows the total driving distance
    # Description: Find the element displaying total distance
    # Locating element: StaticText element displaying the total driving distance of 9.9 miles for the fastest route.
    # Scoped to ancestor [role="main"][aria-label="Directions"]
    # Dynamic text "9.9 miles" → structural regex (2 matches in scope, using .first)
    distance_element = page.get_by_role("main", name=re.compile(r"Directions", re.IGNORECASE)).get_by_text(re.compile(r"^\d+\.\d+\s*miles$")).first
    distance_text = distance_element.text_content()
    print(f"Distance: {distance_text}")

    # Get the actual values and element location info for travel time and distance
    # AI extraction: Extract travel time and distance values from their elements
    # Results: {"travelTime":"19 min","distance":"9.9 miles","travelTimeElementInfo":"[1-1647] StaticText: 19 min","distanceElementInfo":"[1-1648] StaticText: 9.9 miles"}

    # Take screenshot: directions_result
    page.screenshot(path="directions_result.png")

    # ---------------------
    # Cleanup
    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)
