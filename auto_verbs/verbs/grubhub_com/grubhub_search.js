/**
 * Grubhub – Thai Food in Chicago, IL
 *
 * Prompt: Set delivery address "Chicago, IL 60601", search "Thai food",
 *         top 5 restaurants (name, rating, est. delivery time).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const CFG = { address: "Chicago, IL 60601", query: "Thai food" };

function getTempProfileDir(site = "grubhub") {
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
Grubhub – Thai Food in Chicago, IL
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

ADDRESS = "${CFG.address}"
QUERY = "${CFG.query}"

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("grubhub_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    restaurants = []
    try:
        print("STEP 1: Navigate to Grubhub...")
        page.goto("https://www.grubhub.com/search?orderMethod=delivery&locationMode=DELIVERY&facetSet=uma498&pageSize=20&hideHat498=true&searchTerm=Thai+food&queryText=Thai+food",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Set address if prompted
        try:
            addr_input = page.locator("input[name='address'], input[placeholder*='address'], input[data-testid='addressInput']").first
            if addr_input.is_visible(timeout=2000):
                addr_input.fill(ADDRESS, timeout=2000)
                page.wait_for_timeout(2000)
                page.locator("[data-testid='addressSuggestion'], li[role='option']").first.evaluate("el => el.click()")
                page.wait_for_timeout(3000)
        except Exception:
            pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract restaurant data...")
        restaurants = ${JSON.stringify(restaurants.length ? restaurants : [], null, 8)}

        if not restaurants:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            i = 0
            while i < len(lines) and len(restaurants) < 5:
                line = lines[i]
                if ("thai" in line.lower() or "restaurant" in line.lower()) and 3 < len(line) < 80:
                    r = {"name": line, "rating": "N/A", "est_time": "N/A"}
                    for j in range(i+1, min(i+5, len(lines))):
                        nl = lines[j]
                        if re.search(r"\\d+\\.\\d|★|star", nl, re.IGNORECASE):
                            r["rating"] = nl[:30]
                        if re.search(r"\\d+.*min", nl, re.IGNORECASE):
                            r["est_time"] = nl[:30]
                    restaurants.append(r)
                i += 1

        print(f"\\nDONE – Top {len(restaurants)} Thai Restaurants:")
        for i, r in enumerate(restaurants, 1):
            print(f"  {i}. {r.get('name', 'N/A')} | ★{r.get('rating', 'N/A')} | {r.get('est_time', 'N/A')}")

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
  console.log("  Grubhub – Thai Food in Chicago, IL");
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
    console.log("🔍 Navigating to Grubhub...");
    await page.goto("https://www.grubhub.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);
    recorder.record("goto", "Navigate to Grubhub");

    // Set address
    console.log("📍 Setting delivery address...");
    try {
      await stagehand.act(`type "${CFG.address}" into the delivery address or location field`);
      await page.waitForTimeout(2_500);
      await stagehand.act("select the first address suggestion");
      await page.waitForTimeout(3_000);
      recorder.record("act", "Set delivery address");
    } catch (e) { console.log(`   ⚠ Address: ${e.message}`); }

    // Search
    console.log("🍜 Searching for Thai food...");
    try {
      await stagehand.act("search for 'Thai food' using the search bar");
      await page.waitForTimeout(2_000);
      await stagehand.act("press Enter or click search");
      await page.waitForTimeout(4_000);
      recorder.record("act", "Search Thai food");
    } catch (e) {
      console.log(`   ⚠ Search: ${e.message}`);
      await page.goto("https://www.grubhub.com/search?orderMethod=delivery&searchTerm=Thai+food", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(4_000);
    }

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting restaurants...");
    const schema = z.object({
      restaurants: z.array(z.object({
        name:     z.string().describe("Restaurant name"),
        rating:   z.string().describe("Rating"),
        est_time: z.string().describe("Estimated delivery time"),
      })).describe("Top 5 Thai restaurants"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 Thai food restaurants shown on this page. For each get: restaurant name, rating, and estimated delivery time.",
          schema,
        );
        if (data?.restaurants?.length > 0) { results = data.restaurants; console.log(`   ✅ Got ${data.restaurants.length} restaurants`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((r, i) => console.log(`  ${i + 1}. ${r.name} | ★${r.rating} | ${r.est_time}`));
    } else { console.log("  No restaurants extracted"); }

    fs.writeFileSync(path.join(__dirname, "grubhub_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
