"""Inspect Expedia search page — find form selectors for destination, dates, submit."""
import os, sys, shutil, time, json
from urllib.request import urlopen
from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

with sync_playwright() as pw:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("expedia_inspect")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = pw.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    print("Loading Expedia hotels page…")
    page.goto("https://www.expedia.com/Hotels", wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(5000)

    # Dismiss popups
    for sel in ["button:has-text('Accept')", "button:has-text('Close')", "button[aria-label='Close']"]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=600):
                loc.evaluate("el => el.click()")
                time.sleep(0.3)
        except:
            pass
    page.wait_for_timeout(1000)

    print(f"URL: {page.url}")

    # Find form elements
    print("\n--- FORM ELEMENTS ---")
    form_info = page.evaluate(r"""() => {
        const results = [];

        // Look for destination/location inputs
        const inputs = document.querySelectorAll('input, button[data-stid], [data-stid]');
        for (const el of inputs) {
            const stid = el.getAttribute('data-stid') || '';
            const placeholder = el.getAttribute('placeholder') || '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            const id = el.id || '';
            const type = el.type || el.tagName;
            const text = el.innerText ? el.innerText.substring(0, 60) : '';
            if (stid || placeholder || ariaLabel || (el.tagName === 'INPUT')) {
                results.push({
                    tag: el.tagName,
                    id,
                    stid,
                    type,
                    placeholder: placeholder.substring(0, 60),
                    ariaLabel: ariaLabel.substring(0, 60),
                    text: text.substring(0, 60),
                    cls: el.className.toString().substring(0, 60),
                });
            }
        }

        // Look for date picker triggers
        const dateEls = document.querySelectorAll('[data-stid*="date"], [aria-label*="date"], [aria-label*="Check"], button[data-testid*="date"]');
        for (const el of dateEls) {
            results.push({
                tag: el.tagName,
                stid: el.getAttribute('data-stid') || '',
                ariaLabel: el.getAttribute('aria-label') || '',
                testid: el.getAttribute('data-testid') || '',
                text: (el.innerText || '').substring(0, 60),
            });
        }

        // Look for submit/search buttons
        const btns = document.querySelectorAll('button[type="submit"], button[data-stid*="search"], [data-stid*="submit"]');
        for (const el of btns) {
            results.push({
                tag: 'BUTTON',
                stid: el.getAttribute('data-stid') || '',
                type: el.type || '',
                text: (el.innerText || '').substring(0, 40),
                ariaLabel: el.getAttribute('aria-label') || '',
            });
        }

        return results;
    }""")
    for item in form_info:
        print(f"  {item}")

    # Also get a snapshot of relevant part of body text
    print("\n--- BODY TEXT (first 1500 chars) ---")
    body = page.evaluate("document.body.innerText.substring(0, 1500)")
    print(body[:1500])

    browser.close()
    chrome_proc.terminate()
    shutil.rmtree(profile_dir, ignore_errors=True)
