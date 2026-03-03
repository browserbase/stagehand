/**
 * Google Maps – Directions (Space Needle → Pike Place)
 *
 * Prompt: Driving directions from Space Needle to Pike Place Market.
 *         Extract route name, travel time, distance, step-by-step directions.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "maps") {
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
Google Maps – Driving Directions (Space Needle → Pike Place)
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

ORIGIN = "Space Needle, Seattle, WA"
DESTINATION = "Pike Place Market, Seattle, WA"

def run(playwright: Playwright) -> dict:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("maps_google_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"route": "", "time": "", "distance": "", "steps": []}
    try:
        print("STEP 1: Navigate to Google Maps directions...")
        url = "https://www.google.com/maps/dir/Space+Needle,+Seattle,+WA/Pike+Place+Market,+Seattle,+WA/"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        # Ensure driving mode
        try:
            driving_btn = page.locator("[data-travel_mode='0'], [aria-label*='Driving']").first
            if driving_btn.is_visible(timeout=2000):
                driving_btn.evaluate("el => el.click()")
                page.wait_for_timeout(3000)
        except Exception:
            pass

        print("STEP 2: Extract route information...")
        body = page.locator("body").inner_text(timeout=10000)

        # Route name
        try:
            result["route"] = page.locator("[data-route-index='0'] h1, .directions-mode-group h1, .section-directions-trip-title").first.inner_text(timeout=2000).strip()
        except Exception:
            m = re.search(r"via (.*?)\\n", body)
            if m:
                result["route"] = "via " + m.group(1).strip()

        # Time & distance
        try:
            trip_el = page.locator("[data-route-index='0'], .section-directions-trip").first
            trip_text = trip_el.inner_text(timeout=2000)
            time_m = re.search(r"(\\d+\\s*(?:min|hour|hr)s?(?:\\s*\\d+\\s*min)?)", trip_text, re.IGNORECASE)
            dist_m = re.search(r"([\\d.]+\\s*(?:mi|km|miles?))", trip_text, re.IGNORECASE)
            if time_m: result["time"] = time_m.group(1).strip()
            if dist_m: result["distance"] = dist_m.group(1).strip()
        except Exception:
            time_m = re.search(r"(\\d+\\s*min)", body)
            dist_m = re.search(r"([\\d.]+\\s*mi)", body)
            if time_m: result["time"] = time_m.group(0)
            if dist_m: result["distance"] = dist_m.group(0)

        # Steps
        try:
            step_els = page.locator("[data-step-index], .directions-mode-step, .adp-substep").all()
            for s in step_els[:15]:
                txt = s.inner_text(timeout=1000).strip()
                if txt and len(txt) > 3:
                    result["steps"].append(txt[:150])
        except Exception:
            pass

        if not result["route"] and not result["time"]:
            result = ${JSON.stringify(r, null, 12)}

        print(f"\\nDONE – Driving Directions:")
        print(f"  Route: {result.get('route', 'N/A')}")
        print(f"  Time: {result.get('time', 'N/A')}")
        print(f"  Distance: {result.get('distance', 'N/A')}")
        print(f"  Steps ({len(result.get('steps', []))}):")
        for i, s in enumerate(result.get("steps", []), 1):
            print(f"    {i}. {s}")

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
  console.log("  Google Maps – Driving Directions");
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
    // Direct URL with origin and destination
    const url = "https://www.google.com/maps/dir/Space+Needle,+Seattle,+WA/Pike+Place+Market,+Seattle,+WA/";
    console.log("🔍 Navigating to Google Maps directions...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8_000);
    recorder.record("goto", "Navigate to Maps directions");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "button:has-text('OK')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Select driving mode
    try {
      await stagehand.act("select Driving mode if not already selected");
      await page.waitForTimeout(3_000);
      recorder.record("act", "Select driving mode");
    } catch {}

    for (let i = 0; i < 4; i++) { await page.evaluate(() => window.scrollBy(0, 400)); await page.waitForTimeout(500); }

    console.log("🎯 Extracting directions...");
    const schema = z.object({
      route:    z.string().describe("Route name (e.g. 'via 5th Ave N')"),
      time:     z.string().describe("Estimated travel time"),
      distance: z.string().describe("Total distance"),
      steps:    z.array(z.string()).describe("Step-by-step driving directions"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the driving directions: route name, estimated travel time, total distance, and step-by-step turn-by-turn directions.",
          schema,
        );
        if (data?.route || data?.time) { results = data; console.log(`   ✅ Got directions (${data.steps?.length || 0} steps)`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.waitForTimeout(2_000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      console.log(`  Route: ${results.route}`);
      console.log(`  Time: ${results.time}`);
      console.log(`  Distance: ${results.distance}`);
      console.log(`  Steps (${results.steps?.length || 0})`);
      results.steps?.forEach((s, i) => console.log(`    ${i + 1}. ${s}`));
    } else { console.log("  No directions extracted"); }

    fs.writeFileSync(path.join(__dirname, "maps_directions.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
