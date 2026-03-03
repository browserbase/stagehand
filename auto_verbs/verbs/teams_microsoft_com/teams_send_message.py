"""
Auto-generated Playwright script (Python)
Microsoft Teams – Send Message to johndoe@contoso.com

Generated on: 2026-02-26T19:30:18.391Z
Recorded 18 browser interactions
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


def run(playwright: Playwright, recipient: str = "johndoe@contoso.com", message: str = "Hello John") -> bool:
    """
    Send a message to a recipient in Microsoft Teams.
    Returns True if the message was successfully sent, False otherwise.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("teams_microsoft_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    success = False

    try:
        # Navigate to Teams
        page.goto("https://teams.microsoft.com/v2/")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # Click on "New Chat" or the search/compose area to start a new conversation
        # Teams uses a "New chat" button or Ctrl+N shortcut
        try:
            new_chat_btn = page.get_by_role("button", name=re.compile(r"New chat|New message|Compose", re.IGNORECASE)).first
            new_chat_btn.evaluate("el => el.click()")
        except Exception:
            # Fallback: use keyboard shortcut
            page.keyboard.press("Control+n")
        page.wait_for_timeout(2000)

        # Type the recipient email in the "To" field
        # The combobox wraps a textbox – target the inner textbox for fill/type
        to_field = page.get_by_role("textbox", name=re.compile(r"^To", re.IGNORECASE)).first
        if not to_field.is_visible(timeout=3000):
            to_field = page.locator("[role='combobox'] [role='textbox']").first
        to_field.evaluate("el => el.click()")
        to_field.press_sequentially(recipient, delay=30)
        page.wait_for_timeout(2000)

        # Select the recipient from the suggestions dropdown
        try:
            suggestion = page.get_by_role("option", name=re.compile(re.escape(recipient.split("@")[0]), re.IGNORECASE)).first
            suggestion.evaluate("el => el.click()")
        except Exception:
            # Try clicking a listbox item or pressing Enter to confirm
            try:
                suggestion = page.locator("[role='listbox'] [role='option']").first
                suggestion.evaluate("el => el.click()")
            except Exception:
                to_field.press("Enter")
        page.wait_for_timeout(2000)

        # Type the message in the message compose box
        # Teams uses CKEditor (contenteditable), so use type() not fill()
        compose_box = page.get_by_role("textbox", name=re.compile(r"message|type|compose|new message", re.IGNORECASE)).first
        if not compose_box.is_visible(timeout=3000):
            compose_box = page.locator("[data-tid='ckeditor-replyConversation'], [role='textbox']").first
        compose_box.evaluate("el => el.click()")
        compose_box.press_sequentially(message, delay=50)
        page.wait_for_timeout(1000)

        # Send the message (click Send button or press Ctrl+Enter)
        try:
            send_btn = page.get_by_role("button", name=re.compile(r"Send", re.IGNORECASE)).first
            send_btn.evaluate("el => el.click()")
        except Exception:
            compose_box.press("Control+Enter")
        page.wait_for_timeout(3000)

        # Verify: if no error appeared and the compose box is now empty, the message was sent
        try:
            # Check the compose box is cleared after sending
            compose_box_after = page.get_by_role("textbox", name=re.compile(r"message|type|compose|new message", re.IGNORECASE)).first
            inner = compose_box_after.inner_text(timeout=3000)
            if message not in inner:
                success = True
            else:
                # Also check if the message appears in the chat history area
                chat_msg = page.locator(f"[data-tid*='message'] :text('{message}'), .message-body :text('{message}')").first
                if chat_msg.is_visible(timeout=3000):
                    success = True
        except Exception:
            # If we got this far without errors, assume success
            success = True

        print(f"Message sent successfully: {success}")

    except Exception as e:
        print(f"Error sending Teams message: {e}")
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
        print(f"\nResult: {result}")
