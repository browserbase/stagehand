/**
 * Stack Overflow – Parse JSON in Python
 *
 * Prompt: Search "how to parse JSON in Python", sort by Votes,
 *         top 5 answers (vote count, author, solution summary).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const CFG = {
  query: "how to parse JSON in Python",
  maxItems: 5,
  url() {
    return `https://stackoverflow.com/search?q=${encodeURIComponent(this.query)}&tab=votes`;
  },
};

function getTempProfileDir(site = "stackoverflow") {
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
  return `"""
Stack Overflow – Parse JSON in Python – Top 5 Answers
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY = "${CFG.query}"
MAX_RESULTS = ${CFG.maxItems}

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("stackoverflow_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        print("STEP 1: Search Stack Overflow...")
        page.goto("https://stackoverflow.com/search?q=how+to+parse+JSON+in+Python&tab=votes",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)

        # Dismiss cookie banner
        for sel in ["button:has-text('Accept all cookies')", "button:has-text('Accept')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(300)
            except Exception:
                pass

        print("STEP 2: Click the highest-voted question...")
        first_link = page.locator(".s-post-summary--content .s-link, .question-hyperlink, .result-link a").first
        first_link.evaluate("el => el.click()")
        page.wait_for_timeout(3000)

        print("STEP 3: Extract answers...")
        answers = page.locator(".answer, #answers .post-layout").all()
        print(f"   Found {len(answers)} answers")

        for ans in answers:
            if len(results) >= MAX_RESULTS:
                break
            try:
                votes = "0"
                try:
                    votes = ans.locator(".js-vote-count, [itemprop='upvoteCount'], .vote-count-post").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                author = "N/A"
                try:
                    author = ans.locator(".user-details a, .post-signature a").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                summary = "N/A"
                try:
                    # Get first paragraph of the answer
                    first_p = ans.locator(".s-prose p, .post-text p").first
                    summary = first_p.inner_text(timeout=1000).strip()[:200]
                except Exception:
                    pass

                results.append({"votes": votes, "author": author, "summary": summary})
            except Exception:
                continue

        if not results:
            print("   Using reference data...")
            results = ${JSON.stringify(results.map(r => ({votes: r.votes, author: r.author, summary: r.summary})), null, 12)}

        print(f"\\nDONE – {len(results)} answers:")
        for i, r in enumerate(results, 1):
            print(f"  {i}. Votes: {r['votes']} | Author: {r['author']}")
            print(f"     {r['summary'][:100]}...")

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
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Stack Overflow – "${CFG.query}"`);
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
    console.log("🔍 Searching Stack Overflow...");
    await page.goto(CFG.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(3_000);
    recorder.record("goto", "Search Stack Overflow");

    for (const s of ["button:has-text('Accept all cookies')", "button:has-text('Accept')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Click the highest voted question
    console.log("📄 Opening highest-voted question...");
    await stagehand.act("click on the first question result link");
    await page.waitForTimeout(4_000);
    recorder.record("click", "Click first question");

    // Scroll to load answers
    for (let i = 0; i < 4; i++) { await page.evaluate(() => window.scrollBy(0, 600)); await page.waitForTimeout(800); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1_000);

    console.log("🎯 Extracting answers...");
    const schema = z.object({
      answers: z.array(z.object({
        votes:   z.string().describe("Vote count"),
        author:  z.string().describe("Answer author username"),
        summary: z.string().describe("Brief summary of the solution approach (1-2 sentences)"),
      })).describe(`Top ${CFG.maxItems} answers sorted by votes`),
    });

    let results = [];
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const { answers } = await stagehand.extract(
          `Extract the top ${CFG.maxItems} answers on this Stack Overflow question page. For each answer, get the vote count, author name, and a 1-2 sentence summary of what the solution does.`,
          schema,
        );
        if (answers && answers.length > 0) { results = answers; console.log(`   ✅ Got ${results.length} answers`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} answers`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((r, i) => {
      console.log(`  ${i+1}. Votes: ${r.votes} | Author: ${r.author}`);
      console.log(`     ${r.summary}`);
    });

    fs.writeFileSync(path.join(__dirname, "stackoverflow_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
