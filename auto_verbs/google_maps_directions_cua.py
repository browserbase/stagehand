"""
Auto-generated Playwright script (Python) - CUA Version
Google Maps Driving Directions: Bellevue Square → Redmond Town Center

Generated on: 2026-02-19T19:24:26.836Z
Recorded 1 browser interactions via CUA Agent
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

    # ---------------------
    # Cleanup
    # ---------------------
    context.close()
    browser.close()


with sync_playwright() as playwright:
    run(playwright)
