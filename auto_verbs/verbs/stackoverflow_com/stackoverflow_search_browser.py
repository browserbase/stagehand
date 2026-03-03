"""
StackOverflow – Search and extract top answers
Search via Google for a StackOverflow question, click the top result, extract answers.
Pure Playwright – no AI.

Uses Google search with site:stackoverflow.com to bypass StackOverflow's anti-bot.
"""
import re, os, sys, traceback, shutil, tempfile
from urllib.parse import quote_plus
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, launch_chrome, wait_for_cdp_ws

MAX_RESULTS = 5
DEFAULT_QUERY = "how to parse JSON in Python"


def run(playwright: Playwright, query: str = DEFAULT_QUERY) -> list:
    port = get_free_port()
    profile_dir = tempfile.mkdtemp(prefix="stackoverflow_")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    answers = []
    try:
        # ── STEP 1: Search via Google ─────────────────────────────────
        # Use Google to find StackOverflow questions (bypasses SO's anti-bot)
        google_query = f"site:stackoverflow.com {query}"
        search_url = f"https://www.google.com/search?q={quote_plus(google_query)}"
        print(f"STEP 1: Search Google for StackOverflow questions")
        print(f"   Query: {google_query}")
        page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        # Dismiss Google cookie banner if present
        for sel in ["button:has-text('Accept all')", "button:has-text('I agree')", "[aria-label='Accept all']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.click()
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 2: Click first StackOverflow result ──────────────────
        print("STEP 2: Click first StackOverflow result from Google...")
        
        # Find StackOverflow links in Google results
        so_link = page.locator("a[href*='stackoverflow.com/questions/']").first
        
        try:
            question_title = so_link.inner_text(timeout=5000).strip()
            print(f"   Found: {question_title}")
            so_link.click()
            page.wait_for_timeout(4000)
        except Exception as e:
            print(f"❌ ERROR: Could not find StackOverflow link in Google results: {e}")
            print(f"   Page URL: {page.url}")
            return answers

        # Check if we hit CAPTCHA after clicking
        if "nocaptcha" in page.url or "captcha" in page.url.lower() or "Just a moment" in page.title():
            print("❌ ERROR: StackOverflow CAPTCHA/Cloudflare triggered. Cannot proceed.")
            return answers
        
        # Dismiss StackOverflow cookie banner
        for sel in ["button:has-text('Accept all cookies')", "button:has-text('Necessary cookies only')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.click()
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 3: Extract answers ───────────────────────────────────
        print("STEP 3: Extract answers...")
        print(f"   Page URL: {page.url}")
        print(f"   Page title: {page.title()}")
        
        # Check if we actually reached StackOverflow
        if "stackoverflow.com" not in page.url:
            print("❌ ERROR: Did not reach StackOverflow page.")
            return answers
        
        if "Just a moment" in page.title():
            print("❌ ERROR: Cloudflare challenge page.")
            return answers

        # Scroll to load content
        for _ in range(8):
            page.evaluate("window.scrollBy(0, 800)")
            page.wait_for_timeout(400)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(500)

        # Strategy 1: answer elements
        answer_elements = page.locator(".answer, [data-answerid]").all()
        print(f"   Found {len(answer_elements)} answer elements")

        for ans_el in answer_elements:
            if len(answers) >= MAX_RESULTS:
                break
            try:
                # Vote count
                vote_count = "0"
                try:
                    vote_count = ans_el.locator("[itemprop='upvoteCount'], .js-vote-count").first.inner_text(timeout=2000).strip()
                except Exception:
                    try:
                        vote_count = ans_el.locator("[data-value]").first.get_attribute("data-value") or "0"
                    except Exception:
                        pass

                # Author
                author = "N/A"
                try:
                    author = ans_el.locator(".user-details a, .s-user-card--link a").first.inner_text(timeout=2000).strip()
                except Exception:
                    try:
                        author = ans_el.locator("[itemprop='name']").first.inner_text(timeout=1000).strip()
                    except Exception:
                        pass

                # Answer text summary
                summary = ""
                try:
                    post_body = ans_el.locator(".s-prose, .post-text, .js-post-body").first
                    full_text = post_body.inner_text(timeout=3000).strip()
                    paragraphs = [p.strip() for p in full_text.split("\n") if p.strip() and len(p.strip()) > 20]
                    summary = paragraphs[0][:200] if paragraphs else full_text[:200]
                except Exception:
                    pass

                if summary:
                    answers.append({
                        "votes": vote_count,
                        "author": author,
                        "summary": summary,
                    })
            except Exception:
                continue

        # Strategy 2: body text fallback
        if not answers:
            print("   Strategy 1 found 0 — trying body text...")
            body = page.inner_text("body")
            lines = [l.strip() for l in body.splitlines() if l.strip()]
            # Look for answer sections — identifiable by vote counts and "answered" markers
            i = 0
            while i < len(lines) and len(answers) < MAX_RESULTS:
                if re.match(r'^\d+$', lines[i]):
                    votes = lines[i]
                    # Look ahead for meaningful content
                    for j in range(i + 1, min(i + 30, len(lines))):
                        if len(lines[j]) > 60 and not re.match(r'^(Share|Follow|Edit|Flag|answered|edited)', lines[j]):
                            # Look for author near this block
                            author = "N/A"
                            for k in range(j, min(j + 15, len(lines))):
                                if re.match(r'^answered\s', lines[k], re.IGNORECASE):
                                    if k + 1 < len(lines) and len(lines[k + 1]) < 40:
                                        author = lines[k + 1].strip()
                                    break
                            answers.append({
                                "votes": votes,
                                "author": author,
                                "summary": lines[j][:200],
                            })
                            i = j + 1
                            break
                    else:
                        i += 1
                else:
                    i += 1

        if not answers:
            print("❌ ERROR: Extraction failed — no answers found from the page.")

        print(f"\nDONE – Top {len(answers)} Answers:")
        for i, a in enumerate(answers, 1):
            print(f"  {i}. [{a['votes']} votes] by {a['author']}")
            print(f"     {a['summary'][:120]}...")

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
    return answers

if __name__ == "__main__":
    # Accept query as command line argument, or use default
    query = " ".join(sys.argv[1:]) if len(sys.argv) > 1 else DEFAULT_QUERY
    print(f"Query: {query}\n")
    with sync_playwright() as playwright:
        run(playwright, query=query)
