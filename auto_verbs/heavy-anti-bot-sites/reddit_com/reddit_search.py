"""
Reddit – Best Budget Laptop Search in r/laptops
Generated: 2026-02-28T06:50:54.802Z
Pure Playwright – no AI.
"""
import re, os, traceback
from playwright.sync_api import Playwright, sync_playwright

import sys as _sys
import os as _os
_sys.path.insert(0, _os.path.join(_os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws
import shutil

QUERY = "best budget laptop 2026"
SUBREDDIT = "laptops"
MAX_RESULTS = 5
URL = "https://www.reddit.com/r/laptops/search/?q=best%20budget%20laptop%202026&sort=top&restrict_sr=1"

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("reddit_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        print("STEP 1: Navigate to Reddit search...")
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Dismiss popups
        for sel in ["button:has-text('Accept All')", "button:has-text('Continue')", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(300)
            except Exception:
                pass

        print("STEP 2: Extract posts...")
        # Reddit posts are in article or shreddit-post elements
        posts = page.locator("shreddit-post, article, [data-testid='post-container'], .thing").all()
        print(f"   Found {len(posts)} post elements")

        for post in posts:
            if len(results) >= MAX_RESULTS:
                break
            try:
                title = ""
                try:
                    title = post.locator("a[slot='title'], h3, [data-testid='post-title'], .title a").first.inner_text(timeout=1000).strip()
                except Exception:
                    try:
                        title = post.get_attribute("post-title") or ""
                    except Exception:
                        pass
                if not title or len(title) < 5:
                    continue

                upvotes = "N/A"
                try:
                    upvotes = post.locator("[score], .score, [data-testid='vote-score'], faceplate-number").first.inner_text(timeout=1000).strip()
                except Exception:
                    try:
                        upvotes = post.get_attribute("score") or "N/A"
                    except Exception:
                        pass

                comments = "N/A"
                try:
                    comment_el = post.locator("a:has-text('comment'), [data-testid='comment-count']").first
                    txt = comment_el.inner_text(timeout=1000).strip()
                    num = re.search(r'(\d+)', txt)
                    comments = num.group(1) if num else txt
                except Exception:
                    try:
                        comments = post.get_attribute("comment-count") or "N/A"
                    except Exception:
                        pass

                results.append({"title": title, "upvotes": upvotes, "comments": comments})
            except Exception:
                continue

        if not results:
            print("   Fallback: using reference data...")
            results = []

        print(f"\nDONE – {len(results)} posts:")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['title']}")
            print(f"     Upvotes: {r['upvotes']} | Comments: {r['comments']}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            browser.close()
        except Exception:
            pass
        chrome_proc.terminate()
        shutil.rmtree(profile_dir, ignore_errors=True)
    return results

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
