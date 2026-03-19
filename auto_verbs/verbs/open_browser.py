"""
Open Chrome browser using the persistent Playwright profile.
NOTE: Close Chrome first before running this script!

Uses "User Data/Default" so Playwright can control the browser via remote debugging.
(The parent "User Data" dir is rejected by Chrome for remote debugging.)
Log into any accounts you need here — the login persists for all future scripts.
"""

import os
import sys
from playwright.sync_api import sync_playwright

def run():
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default"
    )

    # Optional: pass a URL as argument, otherwise open Google sign-in
    url = sys.argv[1] if len(sys.argv) > 1 else "https://accounts.google.com"

    with sync_playwright() as playwright:
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
        page.goto(url)
        print(f"Browser opened → {url}")
        print("Press Enter in this terminal when you're done to close the browser...")
        input()
        print("Closing browser.")
        context.close()

if __name__ == "__main__":
    run()
