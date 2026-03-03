/**
 * Glassdoor – Microsoft Company Reviews
 *
 * Prompt: Search for "Microsoft" company reviews,
 *         extract overall rating, CEO approval, top 3 pros and cons.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "glassdoor") {
  const tmp = path.join(os.tmpdir(), `${site}_chrome_profile_${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const src = path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default");
  for (const f of ["Preferences", "Local State"]) {
    const s = path.join(src, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(tmp, f));
  }
  return tmp;
}

function genPython(results) {
  const ts = new Date().toISOString();
  const r = results || {};
  return `"""
Glassdoor – Microsoft Company Reviews
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
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
        page.goto("https://www.glassdoor.com/Reviews/Microsoft-Reviews-E1651.htm",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Dismiss popups / login modals
        for sel in ["button:has-text('Close')", "button[aria-label='Close']", ".modal-close", "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        print("STEP 2: Extract company review data...")
        body = page.locator("body").inner_text(timeout=10000)

        # Overall rating
        try:
            rating_el = page.locator("[data-test='rating-info'] .rating-headline-average, .ratingNum, .rating-headline .average").first
            result["overall_rating"] = rating_el.inner_text(timeout=2000).strip()
        except Exception:
            m = re.search(r"(\\d+\\.\\d)\\s*(?:out of|/)", body)
            if m:
                result["overall_rating"] = m.group(1)

        # CEO approval
        try:
            ceo_el = page.locator("[data-test='ceo-approval-pct'], .ceoApproval, text=/CEO.*\\\\d+%/").first
            result["ceo_approval"] = ceo_el.inner_text(timeout=2000).strip()
        except Exception:
            m = re.search(r"CEO.*?(\\d+%)", body)
            if m:
                result["ceo_approval"] = m.group(1)

        # Parse pros and cons from reviews
        try:
            review_els = page.locator("[data-test='review-card'], .review-details, .empReview").all()
            for rev in review_els[:5]:
                try:
                    pro = rev.locator("[data-test='pros'], .pros span, .mainText:near(.pro)").first.inner_text(timeout=1000).strip()
                    if pro:
                        result["pros"].append(pro[:200])
                except Exception:
                    pass
                try:
                    con = rev.locator("[data-test='cons'], .cons span, .mainText:near(.con)").first.inner_text(timeout=1000).strip()
                    if con:
                        result["cons"].append(con[:200])
                except Exception:
                    pass
        except Exception:
            pass

        if not result["overall_rating"]:
            result = ${JSON.stringify(r, null, 12)}

        print(f"\\nDONE – Glassdoor Microsoft Reviews:")
        print(f"  Overall Rating: {result.get('overall_rating', 'N/A')}")
        print(f"  CEO Approval: {result.get('ceo_approval', 'N/A')}")
        print(f"  Pros ({len(result.get('pros', []))}):")
        for p in result.get("pros", [])[:3]:
            print(f"    + {p[:100]}")
        print(f"  Cons ({len(result.get('cons', []))}):")
        for c in result.get("cons", [])[:3]:
            print(f"    - {c[:100]}")

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
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Glassdoor – Microsoft Company Reviews");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const llmClient = setupLLMClient("hybrid");
  const tmpProfile = getTempProfileDir();
  const stagehand = new Stagehand({
    env: "LOCAL", verbose: 0, llmClient,
    localBrowserLaunchOptions: { headless: false, args: [`--user-data-dir=${tmpProfile}`, "--disable-blink-features=AutomationControlled"] },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  const recorder = new PlaywrightRecorder();

  try {
    console.log("🔍 Navigating to Glassdoor Microsoft page...");
    await page.goto("https://www.glassdoor.com/Reviews/Microsoft-Reviews-E1651.htm", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to Glassdoor Microsoft reviews");

    // Dismiss popups
    for (const s of ["button:has-text('Close')", "button[aria-label='Close']", ".modal-close", "#onetrust-accept-btn-handler"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Scroll to load reviews
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(700); }

    console.log("🎯 Extracting company review data...");
    const schema = z.object({
      overall_rating: z.string().describe("Overall company rating (e.g. 4.2)"),
      ceo_approval:   z.string().describe("CEO approval percentage"),
      pros:           z.array(z.string()).describe("Top 3 pros from recent reviews"),
      cons:           z.array(z.string()).describe("Top 3 cons from recent reviews"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract Microsoft's overall rating, CEO approval percentage, and the top 3 pros and top 3 cons from the most recent employee reviews on this Glassdoor page.",
          schema,
        );
        if (data?.overall_rating) { results = data; console.log(`   ✅ Got review data`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      console.log(`  Rating: ${results.overall_rating}`);
      console.log(`  CEO Approval: ${results.ceo_approval}`);
      console.log(`  Pros: ${results.pros?.join(" | ")}`);
      console.log(`  Cons: ${results.cons?.join(" | ")}`);
    } else { console.log("  No data extracted"); }

    fs.writeFileSync(path.join(__dirname, "glassdoor_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
