"""
Glassdoor – Microsoft Company Reviews
Pure Playwright – no AI.
"""
import re, os, sys, traceback, shutil, tempfile
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(playwright: Playwright) -> dict:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("glassdoor_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"overall_rating": "", "ceo_approval": "", "pros": [], "cons": []}
    try:
        print("STEP 1: Navigate to Glassdoor Microsoft reviews...")
        page.goto(
            "https://www.glassdoor.com/Reviews/Microsoft-Reviews-E1651.htm",
            wait_until="domcontentloaded", timeout=30000,
        )
        page.wait_for_timeout(8000)

        # Check for Cloudflare / bot protection block
        body_check = page.inner_text("body")
        if "protect glassdoor" in body_check.lower() or "verify" in body_check.lower():
            print("   Cloudflare challenge detected — waiting longer...")
            page.wait_for_timeout(10000)
            body_check = page.inner_text("body")

        if "protect glassdoor" in body_check.lower():
            print("   Still blocked — trying alternative URL...")
            page.goto(
                "https://www.glassdoor.com/Overview/Working-at-Microsoft-EI_IE1651.htm",
                wait_until="domcontentloaded", timeout=30000,
            )
            page.wait_for_timeout(8000)

        # Dismiss popups / cookie banners / sign-in modals
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler",
                     "[aria-label='Close']", "button:has-text('OK')",
                     "button:has-text('Close')", "[class*='modal'] button[class*='close']",
                     "button:has-text('No Thanks')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load content
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract company review data...")

        # Strategy 1: selectors for rating
        for sel in [
            "[data-test='rating-info'] [class*='rating']",
            "[class*='ratingNum']",
            "[class*='overall-rating']",
            "[class*='RatingHeadline'] span",
        ]:
            try:
                el = page.locator(sel).first
                val = el.inner_text(timeout=1500).strip()
                if re.match(r"^\d\.\d$", val):
                    result["overall_rating"] = val
                    break
            except Exception:
                continue

        # CEO approval
        for sel in [
            "[data-test='ceo-approval']",
            "[class*='ceoApproval']",
            "[class*='CEOApproval']",
        ]:
            try:
                el = page.locator(sel).first
                val = el.inner_text(timeout=1500).strip()
                m = re.search(r"(\d+%)", val)
                if m:
                    result["ceo_approval"] = m.group(1)
                    break
            except Exception:
                continue

        # Strategy 2: body text parsing
        body = page.inner_text("body")
        lines = [l.strip() for l in body.splitlines() if l.strip()]

        if not result["overall_rating"]:
            m = re.search(r"(\d\.\d)\s*(?:out of\s*5|★|stars?)", body, re.IGNORECASE)
            if m:
                result["overall_rating"] = m.group(1)
            else:
                # Just look for a rating number near "Overall Rating"
                m = re.search(r"(?:Overall|Rating)[:\s]*(\d\.\d)", body, re.IGNORECASE)
                if m:
                    result["overall_rating"] = m.group(1)

        if not result["ceo_approval"]:
            m = re.search(r"(?:CEO|Approve|Approval)[:\s]*(\d+%)", body, re.IGNORECASE)
            if m:
                result["ceo_approval"] = m.group(1)

        # Extract individual reviews to find pros and cons
        # Look for review blocks
        seen_pros = set()
        seen_cons = set()

        # Try review card selectors
        review_sels = [
            "[class*='review-details']",
            "[data-test='review']",
            "[class*='ReviewCard']",
            ".review",
        ]
        for sel in review_sels:
            try:
                reviews = page.locator(sel).all()
                if not reviews:
                    continue
                print(f"   Found {len(reviews)} review elements with '{sel}'")
                for rv in reviews:
                    if len(result["pros"]) >= 3 and len(result["cons"]) >= 3:
                        break
                    text = rv.inner_text(timeout=2000)
                    # Look for "Pros" and "Cons" sections
                    pro_match = re.search(r"Pros?\s*[:\n](.+?)(?:Cons?|$)", text, re.DOTALL | re.IGNORECASE)
                    con_match = re.search(r"Cons?\s*[:\n](.+?)(?:Advice|Continue|$)", text, re.DOTALL | re.IGNORECASE)
                    if pro_match and len(result["pros"]) < 3:
                        pro_text = pro_match.group(1).strip()
                        first_line = pro_text.splitlines()[0].strip()
                        if first_line and len(first_line) > 5 and first_line.lower() not in seen_pros:
                            seen_pros.add(first_line.lower())
                            result["pros"].append(first_line)
                    if con_match and len(result["cons"]) < 3:
                        con_text = con_match.group(1).strip()
                        first_line = con_text.splitlines()[0].strip()
                        if first_line and len(first_line) > 5 and first_line.lower() not in seen_cons:
                            seen_cons.add(first_line.lower())
                            result["cons"].append(first_line)
                if result["pros"] or result["cons"]:
                    break
            except Exception:
                continue

        # Fallback: parse pros/cons from body text
        if not result["pros"]:
            in_pro = False
            for ln in lines:
                if re.match(r"^Pros?$", ln, re.IGNORECASE):
                    in_pro = True
                    continue
                if re.match(r"^(Cons?|Advice|Continue|Was this)$", ln, re.IGNORECASE):
                    in_pro = False
                if in_pro and len(ln) > 10 and len(ln) < 300:
                    key = ln.lower()
                    if key not in seen_pros:
                        seen_pros.add(key)
                        result["pros"].append(ln)
                        if len(result["pros"]) >= 3:
                            break

        if not result["cons"]:
            in_con = False
            for ln in lines:
                if re.match(r"^Cons?$", ln, re.IGNORECASE):
                    in_con = True
                    continue
                if re.match(r"^(Advice|Continue|Was this|Pros?)$", ln, re.IGNORECASE):
                    in_con = False
                if in_con and len(ln) > 10 and len(ln) < 300:
                    key = ln.lower()
                    if key not in seen_cons:
                        seen_cons.add(key)
                        result["cons"].append(ln)
                        if len(result["cons"]) >= 3:
                            break

        has_data = result["overall_rating"] or result["pros"] or result["cons"]
        if not has_data:
            body_final = page.inner_text("body")
            if "protect glassdoor" in body_final.lower() or "verify" in body_final.lower():
                print("❌ ERROR: Blocked by Cloudflare bot protection. Glassdoor requires browser verification.")
            else:
                print("❌ ERROR: Could not extract review data.")

        print(f"\nDONE – Microsoft Reviews:")
        print(f"  Overall Rating: {result['overall_rating'] or 'N/A'}")
        print(f"  CEO Approval:   {result['ceo_approval'] or 'N/A'}")
        if result["pros"]:
            print(f"  Pros:")
            for i, p in enumerate(result["pros"], 1):
                print(f"    {i}. {p}")
        else:
            print("  Pros: N/A")
        if result["cons"]:
            print(f"  Cons:")
            for i, c in enumerate(result["cons"], 1):
                print(f"    {i}. {c}")
        else:
            print("  Cons: N/A")

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
    return result


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
