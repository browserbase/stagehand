"""
Auto-generated Playwright script (Python)
Amazon Clear Shopping Cart

Generated on: 2026-02-26T20:44:01.913Z
Recorded 3 browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import sys
import os
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil


def clear_cart(playwright: Playwright) -> bool:
    """Clear all items from the Amazon shopping cart.

    Returns:
        True if the cart was successfully cleared (or was already empty),
        False if something went wrong.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("amazon_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    success = False
    try:
        # Navigate to the cart page
        page.goto("https://www.amazon.com/gp/cart/view.html")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Check if the cart is already empty
        empty_msg = page.locator("h1:has-text('Your Amazon Cart is empty'), h2:has-text('Your Amazon Cart is empty'), .sc-empty-cart-header")
        if empty_msg.count() > 0:
            print("Cart is already empty.")
            success = True
            return success

        # Repeatedly delete items until the cart is empty
        max_iterations = 50  # Safety limit
        for i in range(max_iterations):
            # Look for "Delete" buttons/links in the cart
            delete_btns = page.locator(
                "input[value='Delete'], "
                "a:has-text('Delete'), "
                "span.a-declarative[data-action='delete'] input, "
                "[data-action='delete'] input[type='submit'], "
                "input[data-action='delete']"
            )

            if delete_btns.count() == 0:
                # No more delete buttons — cart should be empty
                print(f"All items removed. Cleared {i} item(s).")
                success = True
                break

            # Click the first delete button
            try:
                delete_btns.first.evaluate("el => el.click()")
                page.wait_for_timeout(2000)
                # Wait for the page to update
                page.wait_for_load_state("domcontentloaded")
                page.wait_for_timeout(1000)
                print(f"  Removed item {i + 1}")
            except Exception as e:
                print(f"  Warning: could not remove item {i + 1}: {e}")
                break

        # Final check: verify cart is empty
        page.wait_for_timeout(2000)
        empty_msg = page.locator("h1:has-text('Your Amazon Cart is empty'), h2:has-text('Your Amazon Cart is empty'), .sc-empty-cart-header")
        remaining = page.locator(
            "input[value='Delete'], "
            "a:has-text('Delete'), "
            "[data-action='delete'] input[type='submit']"
        )
        if empty_msg.count() > 0 or remaining.count() == 0:
            success = True
            print("Cart successfully cleared!")
        else:
            print(f"Warning: {remaining.count()} item(s) may still remain in the cart.")
            success = False

    except Exception as e:
        print(f"Error clearing cart: {e}")
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
        result = clear_cart(playwright)
        print(f"\nSuccess: {result}")
        sys.exit(0 if result else 1)
