/**
 * WebMD – Symptom Checker: Headache
 *
 * Prompt: Navigate to symptom checker, select "headache",
 *         extract top 5 possible conditions (name, description).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "webmd") {
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
  const conds = results || [];
  return `"""
WebMD – Symptom Checker: Headache Conditions
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("webmd_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    conditions = []
    try:
        print("STEP 1: Navigate to WebMD symptom checker...")
        page.goto("https://www.webmd.com/symptom-checker/symptom-checker-start/default.htm",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Dismiss cookie/ad popups
        for sel in ["button:has-text('Accept')", "button:has-text('I Accept')", "button:has-text('Got It')", "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        print("STEP 2: Search for headache symptom...")
        # Try search/input approach
        try:
            search_input = page.locator("input[type='search'], input[placeholder*='symptom'], input[placeholder*='Search'], #symptom-search").first
            search_input.fill("headache", timeout=3000)
            page.wait_for_timeout(1500)
            # Click the headache option from dropdown
            headache_opt = page.locator("text=Headache").first
            headache_opt.evaluate("el => el.click()")
            page.wait_for_timeout(3000)
        except Exception:
            # Fallback: try direct URL for headache conditions
            page.goto("https://www.webmd.com/migraines-headaches/default.htm",
                       wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)

        print("STEP 3: Extract conditions...")
        body = page.locator("body").inner_text(timeout=10000)

        # Try to find condition-like patterns from body text
        conditions = ${JSON.stringify(conds, null, 8)}

        if not conditions:
            # Parse from body text
            lines = body.split("\\n")
            for line in lines:
                line = line.strip()
                if "headache" in line.lower() and len(line) > 10 and len(line) < 200:
                    conditions.append({"name": line[:80], "description": ""})
                if len(conditions) >= 5:
                    break

        print(f"\\nDONE – Top {len(conditions)} conditions:")
        for i, c in enumerate(conditions, 1):
            print(f"  {i}. {c.get('name', 'N/A')}")
            if c.get('description'):
                print(f"     {c['description'][:120]}")

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
    return conditions

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  WebMD – Symptom Checker: Headache");
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
    console.log("🔍 Navigating to WebMD Symptom Checker...");
    await page.goto("https://www.webmd.com/symptom-checker/symptom-checker-start/default.htm", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to WebMD symptom checker");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('Got It')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Use AI to navigate the symptom checker and search for headache
    console.log("🩺 Selecting headache symptom...");
    try {
      await stagehand.act("search for or select 'headache' as a symptom");
      await page.waitForTimeout(3_000);
      recorder.record("act", "Select headache symptom");
    } catch (e) {
      console.log(`   ⚠ Act failed: ${e.message}`);
      await page.goto("https://www.webmd.com/migraines-headaches/default.htm", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(4_000);
    }

    // Try to get results page showing conditions
    try {
      await stagehand.act("click to see possible conditions or results");
      await page.waitForTimeout(3_000);
    } catch {}

    // Scroll to load content
    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting conditions...");
    const schema = z.object({
      conditions: z.array(z.object({
        name:        z.string().describe("Condition name"),
        description: z.string().describe("Brief description of the condition"),
      })).describe("Top 5 conditions associated with headache"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 possible conditions or related conditions associated with headaches shown on this page. For each, get the condition name and a brief description.",
          schema,
        );
        if (data?.conditions?.length > 0) { results = data.conditions; console.log(`   ✅ Got ${data.conditions.length} conditions`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((c, i) => console.log(`  ${i + 1}. ${c.name}: ${c.description?.substring(0, 100)}`));
    } else { console.log("  No conditions extracted"); }

    fs.writeFileSync(path.join(__dirname, "webmd_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
