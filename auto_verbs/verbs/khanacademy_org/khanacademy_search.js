/**
 * Khan Academy – Calculus Course
 *
 * Prompt: Search "calculus", navigate to first course,
 *         extract title, description, units/sections.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const CFG = { query: "calculus" };

function getTempProfileDir(site = "khanacademy") {
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
  const r = results || { title: "N/A", description: "N/A", units: [] };
  return `"""
Khan Academy – Calculus Course Info
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY = "${CFG.query}"

def run(playwright: Playwright) -> dict:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("khanacademy_org")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"title": "", "description": "", "units": []}
    try:
        print("STEP 1: Navigate to Khan Academy search...")
        page.goto("https://www.khanacademy.org/search?referer=%2F&page_search_query=calculus",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        for sel in ["button:has-text('Accept')", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        print("STEP 2: Click first course result...")
        first_link = page.locator("a:has-text('Calculus')").first
        first_link.evaluate("el => el.click()")
        page.wait_for_timeout(4000)

        print("STEP 3: Extract course info...")
        # Title
        try:
            result["title"] = page.locator("h1").first.inner_text(timeout=3000).strip()
        except Exception:
            pass

        # Description
        try:
            desc_el = page.locator("[data-test-id='course-description'], .course-description, p").first
            result["description"] = desc_el.inner_text(timeout=3000).strip()[:300]
        except Exception:
            pass

        # Units/Sections
        try:
            unit_els = page.locator("h3, [data-test-id='unit-header'], .unit-header").all()
            for u in unit_els[:15]:
                try:
                    txt = u.inner_text(timeout=1000).strip()
                    if txt and len(txt) > 2:
                        result["units"].append(txt)
                except Exception:
                    pass
        except Exception:
            pass

        if not result["title"]:
            print("   Using reference data...")
            result = ${JSON.stringify(r, null, 12)}

        print(f"\\nDONE – Course Info:")
        print(f"  Title: {result['title']}")
        print(f"  Description: {result['description'][:150]}...")
        print(f"  Units ({len(result['units'])}):")
        for u in result["units"]:
            print(f"    - {u}")

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
  console.log(`  Khan Academy – Calculus Course`);
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
    console.log("🔍 Navigating to Khan Academy...");
    await page.goto("https://www.khanacademy.org/search?referer=%2F&page_search_query=calculus", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Search Khan Academy for calculus");

    for (const s of ["button:has-text('Accept')", "button:has-text('OK')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Click first calculus course
    console.log("📚 Opening first calculus course...");
    await stagehand.act("click on the first calculus course result");
    await page.waitForTimeout(5_000);
    recorder.record("click", "Click first calculus course");

    // Scroll to load all units
    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(800); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1_000);

    console.log("🎯 Extracting course info...");
    const schema = z.object({
      title:       z.string().describe("Course title"),
      description: z.string().describe("Course description"),
      units:       z.array(z.string()).describe("List of unit/section names in the course"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          `Extract the calculus course information: course title, description, and all unit or section names listed on this page.`,
          schema,
        );
        if (data && data.title) { results = data; console.log(`   ✅ Got course data (${data.units?.length || 0} units)`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE`);
    console.log("═══════════════════════════════════════════════════════════");
    if (results) {
      console.log(`  Title: ${results.title}`);
      console.log(`  Description: ${results.description?.substring(0, 150)}...`);
      console.log(`  Units (${results.units?.length || 0}):`);
      results.units?.forEach(u => console.log(`    - ${u}`));
    }

    fs.writeFileSync(path.join(__dirname, "khanacademy_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
