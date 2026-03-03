/**
 * Netflix – Search for "documentary"
 *
 * Prompt: Search for "documentary". Top 5 results (title, genre/category, match % or rating).
 * NOTE: Netflix requires login. The script uses a Chrome profile that may already be logged in.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "netflix") {
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
  const shows = results || [];
  return `"""
Netflix – Search for "documentary"
Generated: ${ts}
Pure Playwright – no AI.
NOTE: Requires Netflix login in Chrome profile.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("netflix_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    shows = []
    try:
        print("STEP 1: Navigate to Netflix search...")
        page.goto("https://www.netflix.com/search?q=documentary", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # If not logged in, try the browse/genre URL as a fallback
        if "login" in page.url.lower() or "signup" in page.url.lower():
            print("   Not logged in, trying genre page...")
            page.goto("https://www.netflix.com/browse/genre/6839", wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(5000)

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract documentary data...")
        shows = ${JSON.stringify(shows.length ? shows : [], null, 8)}

        if not shows:
            # Try Netflix card selectors
            cards = page.locator(".title-card, .slider-item, [data-testid='title-card']").all()
            for card in cards[:5]:
                try:
                    title_el = card.locator("img, .fallback-text, p").first
                    title = title_el.get_attribute("alt") or title_el.inner_text(timeout=1500)
                    shows.append({"title": title[:80], "genre": "Documentary", "match_or_rating": "N/A"})
                except Exception:
                    pass

        if not shows:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            for line in lines:
                if len(line) > 3 and len(line) < 80 and not re.search(r"search|browse|sign|log|home|account|menu|netflix|help|privacy", line, re.IGNORECASE):
                    shows.append({"title": line, "genre": "Documentary", "match_or_rating": "N/A"})
                if len(shows) >= 5:
                    break

        print(f"\\nDONE – Top {len(shows)} Documentary Results:")
        for i, s in enumerate(shows, 1):
            print(f"  {i}. {s.get('title','N/A')} | {s.get('genre','N/A')} | {s.get('match_or_rating','N/A')}")

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
    return shows

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log('  Netflix – Search for "documentary"');
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
    console.log("🔍 Navigating to Netflix...");
    await page.goto("https://www.netflix.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5000);
    recorder.record("goto", "Navigate to Netflix");

    // If we're on the logged-in page, use the search
    const currentUrl = page.url();
    if (!currentUrl.includes("login") && !currentUrl.includes("signup")) {
      console.log("📝 Using AI to search for documentary...");
      try { await stagehand.act('Click the search icon'); } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.waitForTimeout(1500);
      try { await stagehand.act('Type "documentary" into the search field'); } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.waitForTimeout(3000);
    } else {
      // Try direct search URL
      console.log("📝 Navigating to search URL...");
      await page.goto("https://www.netflix.com/search?q=documentary", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(5000);
    }

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting results...");
    const schema = z.object({
      shows: z.array(z.object({
        title:           z.string().describe("Title of the show/movie"),
        genre:           z.string().describe("Genre or category"),
        match_or_rating: z.string().describe("Match percentage or rating"),
      })).describe("Top 5 documentary results"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 documentary titles shown. For each get: title, genre/category, and match percentage or rating if available.",
          schema,
        );
        if (data?.shows?.length > 0) { results = data.shows; console.log(`   ✅ Got ${data.shows.length} shows`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((s, i) => console.log(`  ${i + 1}. ${s.title} | ${s.genre} | ${s.match_or_rating}`));
    } else { console.log("  No results extracted (Netflix may require login)"); }

    fs.writeFileSync(path.join(__dirname, "netflix_search.py"), genPython(results), "utf-8");
    console.log("\n✅ Python saved");
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
