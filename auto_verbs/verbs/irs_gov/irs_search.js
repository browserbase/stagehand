/**
 * IRS.gov – Where's My Refund?
 *
 * Prompt: Navigate to "Where's My Refund?", extract instructions,
 *         required fields, and helpful links/notices.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "irs") {
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
IRS.gov – Where's My Refund? Page Info
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> dict:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("irs_gov")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"instructions": "", "required_fields": [], "links": []}
    try:
        print("STEP 1: Navigate to IRS refund page...")
        page.goto("https://www.irs.gov/refunds",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        print("STEP 2: Extract page information...")
        body = page.locator("body").inner_text(timeout=10000)

        # Extract instructions from main content
        try:
            main = page.locator("main, #main-content, .field--name-body").first
            result["instructions"] = main.inner_text(timeout=3000).strip()[:500]
        except Exception:
            result["instructions"] = body[:500]

        # Extract required fields
        try:
            labels = page.locator("label, .field-label, li:has-text('Social'), li:has-text('filing'), li:has-text('refund')").all()
            for l in labels[:10]:
                try:
                    txt = l.inner_text(timeout=1000).strip()
                    if txt and len(txt) > 3:
                        result["required_fields"].append(txt)
                except Exception:
                    pass
        except Exception:
            pass

        # Extract links
        try:
            links = page.locator("main a[href], .field--name-body a[href]").all()
            for link in links[:10]:
                try:
                    txt = link.inner_text(timeout=1000).strip()
                    href = link.get_attribute("href", timeout=1000)
                    if txt and href:
                        result["links"].append({"text": txt, "url": href})
                except Exception:
                    pass
        except Exception:
            pass

        if not result["instructions"]:
            result = ${JSON.stringify(r, null, 12)}

        print(f"\\nDONE – IRS Refund Page Info:")
        print(f"  Instructions (first 200 chars): {result['instructions'][:200]}")
        print(f"  Required Fields ({len(result['required_fields'])}):")
        for f in result["required_fields"]:
            print(f"    - {f}")
        print(f"  Links ({len(result['links'])}):")
        for l in result["links"][:5]:
            print(f"    - {l.get('text', 'N/A')}: {l.get('url', 'N/A')}")

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
  console.log("  IRS.gov – Where's My Refund?");
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
    console.log("🔍 Navigating to IRS refund page...");
    await page.goto("https://www.irs.gov/refunds", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to IRS refunds page");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "button:has-text('OK')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Click "Check My Refund Status" or similar button
    try {
      await stagehand.act("click 'Check My Refund Status' or 'Where's My Refund' button or link");
      await page.waitForTimeout(3_000);
      recorder.record("act", "Click refund status link");
    } catch {}

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 400)); await page.waitForTimeout(500); }

    console.log("🎯 Extracting page information...");
    const schema = z.object({
      instructions:    z.string().describe("Page instructions about checking refund status"),
      required_fields: z.array(z.string()).describe("Required information fields (SSN, filing status, refund amount, etc.)"),
      links:           z.array(z.object({
        text: z.string(),
        url:  z.string(),
      })).describe("Helpful links or notices on the page"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the page instructions about checking refund status, the required information fields (like SSN, filing status, refund amount), and any helpful links or notices on this page.",
          schema,
        );
        if (data?.instructions) { results = data; console.log(`   ✅ Got page info`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      console.log(`  Instructions: ${results.instructions?.substring(0, 200)}...`);
      console.log(`  Required Fields: ${results.required_fields?.join(", ")}`);
      console.log(`  Links (${results.links?.length || 0})`);
    } else { console.log("  No data extracted"); }

    fs.writeFileSync(path.join(__dirname, "irs_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
