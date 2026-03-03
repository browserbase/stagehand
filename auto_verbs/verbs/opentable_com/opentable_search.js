/**
 * OpenTable – Restaurant search in Seattle
 *
 * Prompt: Search restaurants in Seattle WA, date 2 months out, party 2, 7PM.
 *         Top 5 restaurants (name, cuisine, rating, available times).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const dt = new Date(); dt.setMonth(dt.getMonth() + 2);
const dateStr = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;

function getTempProfileDir(site = "opentable") {
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
  const restaurants = results || [];
  return `"""
OpenTable – Restaurant search Seattle WA
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("opentable_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    restaurants = []
    try:
        dt = date.today() + timedelta(days=60)
        d_str = dt.strftime("%Y-%m-%d")

        print(f"STEP 1: Navigate to OpenTable (Seattle, {d_str}, party 2, 7PM)...")
        url = f"https://www.opentable.com/s?dateTime={d_str}T19%3A00%3A00&covers=2&metroId=4&regionIds=232&term=Seattle"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Got it')", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract restaurant data...")
        restaurants = ${JSON.stringify(restaurants.length ? restaurants : [], null, 8)}

        if not restaurants:
            # Try structured selectors first
            cards = page.locator("[data-test='restaurant-card'], .restaurant-card, .resultsListItem").all()
            for card in cards[:5]:
                try:
                    txt = card.inner_text(timeout=3000)
                    lines = [l.strip() for l in txt.split("\\n") if l.strip()]
                    name = lines[0] if lines else "N/A"
                    cuisine = ""
                    rating = ""
                    times = ""
                    for ln in lines:
                        if re.search(r"\\d+\\.\\d+|★", ln) and not cuisine:
                            rating = ln[:30]
                        elif any(w in ln.lower() for w in ["italian","american","japanese","french","mexican","seafood","thai","indian","chinese","mediterranean","korean","vietnamese","steakhouse","sushi","bistro"]):
                            cuisine = ln[:40]
                        elif re.search(r"\\d{1,2}:\\d{2}", ln):
                            times = ln[:60]
                    restaurants.append({"name": name, "cuisine": cuisine or "N/A", "rating": rating or "N/A", "available_times": times or "N/A"})
                except Exception:
                    pass

        if not restaurants:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            for i, line in enumerate(lines):
                if re.search(r"\\d+\\.\\d+|★|Exceptional|Awesome|Good", line) and len(line) < 50:
                    name = ""
                    for j in range(max(0, i-3), i):
                        nl = lines[j]
                        if len(nl) > 3 and len(nl) < 60 and not re.search(r"\\$|filter|sort|\\d+\\.\\d+", nl, re.IGNORECASE):
                            name = nl
                            break
                    if name:
                        restaurants.append({"name": name, "cuisine": "N/A", "rating": line[:30], "available_times": "N/A"})
                if len(restaurants) >= 5:
                    break

        print(f"\\nDONE – Top {len(restaurants)} Restaurants:")
        for i, r in enumerate(restaurants, 1):
            print(f"  {i}. {r.get('name','N/A')} | {r.get('cuisine','N/A')} | {r.get('rating','N/A')} | {r.get('available_times','N/A')}")

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
    return restaurants

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  OpenTable – Seattle, ${dateStr}, Party 2, 7PM`);
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
    const url = `https://www.opentable.com/s?dateTime=${dateStr}T19%3A00%3A00&covers=2&metroId=4&regionIds=232&term=Seattle`;
    console.log("🔍 Navigating to OpenTable search...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8000);
    recorder.record("goto", "Navigate to OpenTable search");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "button:has-text('Got it')", "[aria-label='Close']"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting restaurants...");
    const schema = z.object({
      restaurants: z.array(z.object({
        name:             z.string().describe("Restaurant name"),
        cuisine:          z.string().describe("Cuisine type"),
        rating:           z.string().describe("Rating or rating label"),
        available_times:  z.string().describe("Available reservation times"),
      })).describe("Top 5 restaurants in Seattle"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 restaurants shown. For each get: restaurant name, cuisine type, rating, and available reservation times.",
          schema,
        );
        if (data?.restaurants?.length > 0) { results = data.restaurants; console.log(`   ✅ Got ${data.restaurants.length} restaurants`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((r, i) => console.log(`  ${i + 1}. ${r.name} | ${r.cuisine} | ${r.rating} | ${r.available_times}`));
    } else { console.log("  No restaurants extracted"); }

    fs.writeFileSync(path.join(__dirname, "opentable_search.py"), genPython(results), "utf-8");
    console.log("\n✅ Python saved");
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
