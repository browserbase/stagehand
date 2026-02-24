"""
Open a Chrome browser using the current user's profile and wait for 20 minutes.
"""

import os
from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as playwright:
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
        page.goto("about:blank")
        print("Browser opened with user profile. Waiting for 20 minutes...")
        page.wait_for_timeout(20 * 60 * 1000)
        print("Done. Closing browser.")
        context.close()

if __name__ == "__main__":
    run()
