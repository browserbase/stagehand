/**
 * USPS – Package Tracking
 *
 * Prompt: Navigate to tracking page, enter tracking number
 *         "9400111899223456789012", extract status/update/delivery/location.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const TRACKING_NUMBER = "9400111899223456789012";

function getTempProfileDir(site = "usps") {
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
USPS – Package Tracking
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

TRACKING_NUMBER = "${TRACKING_NUMBER}"

def run(playwright: Playwright) -> dict:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("usps_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"status": "", "last_update": "", "expected_delivery": "", "location": ""}
    try:
        print("STEP 1: Navigate to USPS tracking...")
        page.goto(f"https://tools.usps.com/go/TrackConfirmAction?tLabels={TRACKING_NUMBER}",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        print("STEP 2: Extract tracking info...")
        body = page.locator("body").inner_text(timeout=10000)

        # Try specific selectors first
        for sel, key in [
            (".tb-status, .tracking-status, .delivery_status", "status"),
            (".tb-date, .tracking-date", "last_update"),
            (".expected-delivery, .tb-expected-delivery", "expected_delivery"),
            (".tb-location, .tracking-location", "location"),
        ]:
            try:
                el = page.locator(sel).first
                result[key] = el.inner_text(timeout=2000).strip()
            except Exception:
                pass

        # Fallback: parse from body text
        if not result["status"]:
            for pattern, key in [
                (r"(?:Status|Tracking Status)[:\\s]*([^\\n]+)", "status"),
                (r"(?:Last Update|Updated)[:\\s]*([^\\n]+)", "last_update"),
                (r"(?:Expected Delivery|Delivery Date)[:\\s]*([^\\n]+)", "expected_delivery"),
                (r"(?:Location|Current Location)[:\\s]*([^\\n]+)", "location"),
            ]:
                m = re.search(pattern, body, re.IGNORECASE)
                if m:
                    result[key] = m.group(1).strip()

        if not result["status"]:
            result = ${JSON.stringify(r, null, 12)}

        print(f"\\nDONE – Tracking Results:")
        print(f"  Status: {result.get('status', 'N/A')}")
        print(f"  Last Update: {result.get('last_update', 'N/A')}")
        print(f"  Expected Delivery: {result.get('expected_delivery', 'N/A')}")
        print(f"  Location: {result.get('location', 'N/A')}")

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
  console.log("  USPS – Package Tracking");
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
    console.log("🔍 Navigating to USPS tracking...");
    await page.goto(`https://tools.usps.com/go/TrackConfirmAction?tLabels=${TRACKING_NUMBER}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to USPS tracking page");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "button:has-text('OK')", "#ensCloseBanner"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 300)); await page.waitForTimeout(500); }

    console.log("🎯 Extracting tracking information...");
    const schema = z.object({
      status:            z.string().describe("Current tracking status"),
      last_update:       z.string().describe("Date/time of last status update"),
      expected_delivery: z.string().describe("Expected delivery date"),
      location:          z.string().describe("Current/last known location"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the tracking information for this package: current status, last status update date/time, expected delivery date, and current location.",
          schema,
        );
        if (data?.status) { results = data; console.log(`   ✅ Got tracking data`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.waitForTimeout(2_000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      console.log(`  Status: ${results.status}`);
      console.log(`  Last Update: ${results.last_update}`);
      console.log(`  Expected Delivery: ${results.expected_delivery}`);
      console.log(`  Location: ${results.location}`);
    } else { console.log("  No tracking data extracted"); }

    fs.writeFileSync(path.join(__dirname, "usps_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
