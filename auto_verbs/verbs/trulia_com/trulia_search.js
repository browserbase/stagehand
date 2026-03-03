/**
 * Trulia – San Jose CA Rentals
 *
 * Prompt: Search homes for rent in San Jose, CA.
 *         Filter by 2+ bedrooms.
 *         Top 5 listings (address, monthly rent, bedrooms, bathrooms).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "trulia") {
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
  const listings = results || [];
  return `"""
Trulia – San Jose CA Rentals
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("trulia_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    listings = []
    try:
        print("STEP 1: Navigate to Trulia San Jose rentals...")
        page.goto("https://www.trulia.com/for_rent/San_Jose,CA/2p_beds/",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        for sel in ["button:has-text('Accept')", "button:has-text('OK')", "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract rental listings...")
        cards = page.locator("[data-testid='search-result-list-container'] li, .resultCard, [data-hero-element-id]").all()

        for card in cards[:5]:
            try:
                listing = {}
                try:
                    listing["address"] = card.locator("[data-testid='property-address'], .property-address, address").first.inner_text(timeout=1000).strip()
                except Exception:
                    listing["address"] = card.locator("a").first.inner_text(timeout=1000).strip()[:80]

                try:
                    listing["rent"] = card.locator("[data-testid='property-price'], .property-price, span:has-text('$')").first.inner_text(timeout=1000).strip()
                except Exception:
                    listing["rent"] = "N/A"

                try:
                    details = card.locator("[data-testid='property-beds'], [data-testid='property-baths'], .property-detail").all_inner_texts()
                    details_text = " ".join(details)
                    beds_m = re.search(r"(\\d+)\\s*(?:bd|bed)", details_text, re.IGNORECASE)
                    baths_m = re.search(r"(\\d+\\.?\\d*)\\s*(?:ba|bath)", details_text, re.IGNORECASE)
                    listing["beds"] = beds_m.group(1) if beds_m else "N/A"
                    listing["baths"] = baths_m.group(1) if baths_m else "N/A"
                except Exception:
                    listing["beds"] = listing["baths"] = "N/A"

                listings.append(listing)
            except Exception:
                continue

        if not listings:
            listings = ${JSON.stringify(listings.length ? listings : [{"address":"N/A","rent":"N/A","beds":"N/A","baths":"N/A"}], null, 12)}

        print(f"\\nDONE – Top {len(listings)} San Jose Rentals:")
        for i, l in enumerate(listings, 1):
            print(f"  {i}. {l.get('address', 'N/A')} | {l.get('rent', 'N/A')}/mo | {l.get('beds', 'N/A')} bd / {l.get('baths', 'N/A')} ba")

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
    return listings

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Trulia – San Jose CA Rentals");
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
    console.log("🔍 Navigating to Trulia (San Jose rentals, 2+ beds)...");
    await page.goto("https://www.trulia.com/for_rent/San_Jose,CA/2p_beds/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);
    recorder.record("goto", "Navigate to Trulia San Jose rentals");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "button:has-text('OK')", "#onetrust-accept-btn-handler"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Scroll
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(700); }

    console.log("🎯 Extracting rental listings...");
    const schema = z.object({
      listings: z.array(z.object({
        address: z.string().describe("Property address"),
        rent:    z.string().describe("Monthly rent price"),
        beds:    z.string().describe("Number of bedrooms"),
        baths:   z.string().describe("Number of bathrooms"),
      })).describe("Top 5 rental listings"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 rental listings shown on this page. For each get: address, monthly rent, number of bedrooms, and number of bathrooms.",
          schema,
        );
        if (data?.listings?.length > 0) { results = data.listings; console.log(`   ✅ Got ${data.listings.length} listings`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((l, i) => console.log(`  ${i + 1}. ${l.address} | ${l.rent}/mo | ${l.beds}bd/${l.baths}ba`));
    } else { console.log("  No listings extracted"); }

    fs.writeFileSync(path.join(__dirname, "trulia_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
