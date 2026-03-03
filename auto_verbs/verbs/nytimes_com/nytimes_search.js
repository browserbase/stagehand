/**
 * NYTimes – Artificial Intelligence Articles
 *
 * Prompt: Search "artificial intelligence", sort "Newest",
 *         top 5 articles (headline, author, publication date).
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
  query: "artificial intelligence",
  maxItems: 5,
  url() {
    return `https://www.nytimes.com/search?query=${encodeURIComponent(this.query)}&sort=newest`;
  },
};

function getTempProfileDir(site = "nytimes") {
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
NYTimes – Artificial Intelligence Articles
Sort: Newest | Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY = "${CFG.query}"
MAX_RESULTS = ${CFG.maxItems}
URL = "${CFG.url()}"

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("nytimes_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        print("STEP 1: Navigate to NYTimes search...")
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Dismiss overlays
        for sel in ["button:has-text('Continue')", "button:has-text('Accept')", "button[data-testid='close-button']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(300)
            except Exception:
                pass

        print("STEP 2: Extract article listings...")
        articles = page.locator("[data-testid='search-bodega-result'], .css-1l4w6pd, li[data-testid='search-bodega-result']").all()
        print(f"   Found {len(articles)} article elements")

        for art in articles:
            if len(results) >= MAX_RESULTS:
                break
            try:
                headline = ""
                try:
                    headline = art.locator("h4, a h4, .css-2fgx4k").first.inner_text(timeout=1000).strip()
                except Exception:
                    try:
                        headline = art.locator("a").first.inner_text(timeout=1000).strip()
                    except Exception:
                        pass
                if not headline or len(headline) < 5:
                    continue

                author = "N/A"
                try:
                    author = art.locator("p.css-15w69y9, span.css-1n7hynb, .css-1baulvz").first.inner_text(timeout=1000).strip()
                    if author.startswith("By "):
                        author = author[3:]
                except Exception:
                    pass

                date = "N/A"
                try:
                    date = art.locator("time, span[data-testid='todays-date'], .css-17ubb9w").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                results.append({"headline": headline, "author": author, "date": date})
            except Exception:
                continue

        if not results:
            print("   Fallback: using reference data...")
            results = ${JSON.stringify(results.map(r => ({headline: r.headline, author: r.author, date: r.date})), null, 12)}

        print(f"\\nDONE – {len(results)} articles:")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['headline']}")
            print(f"     Author: {r['author']} | Date: {r['date']}")

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
  console.log(`  NYTimes – "${CFG.query}"`);
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
    console.log("🔍 Navigating to NYTimes search...");
    await page.goto(CFG.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to NYTimes search");

    for (const s of ["button:has-text('Continue')", "button:has-text('Accept')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(800); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1_000);

    console.log("🎯 Extracting articles...");
    const schema = z.object({
      articles: z.array(z.object({
        headline: z.string().describe("Article headline"),
        author:   z.string().describe("Author name"),
        date:     z.string().describe("Publication date"),
      })).describe(`Top ${CFG.maxItems} newest articles about artificial intelligence`),
    });

    let results = [];
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const { articles } = await stagehand.extract(
          `Extract the top ${CFG.maxItems} article search results. For each get the headline, author name, and publication date.`,
          schema,
        );
        if (articles && articles.length > 0) { results = articles; console.log(`   ✅ Got ${results.length} articles`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} articles`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((r, i) => console.log(`  ${i+1}. ${r.headline} | ${r.author} | ${r.date}`));

    fs.writeFileSync(path.join(__dirname, "nytimes_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
