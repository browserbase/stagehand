"""
Open Chrome browser using the real user profile.
NOTE: Close Chrome first before running this script!
"""

import os
from playwright.sync_api import sync_playwright

def run():
    # Use Default subfolder (not User Data) to bypass Chrome's restriction
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default"
    )
    
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
        page.goto("about:blank")
        print("Browser opened with user profile.")
        print("Press Enter in this terminal when you're done to close the browser...")
        input()
        print("Closing browser.")
        context.close()

if __name__ == "__main__":
    run()
