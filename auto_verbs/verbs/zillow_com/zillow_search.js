/**
 * Zillow – Bellevue, WA Home Search
 *
 * Prompt: Search homes for sale in Bellevue, WA.
 *         Filter $500K-$1M, 3+ bedrooms.
 *         Top 5 listings (address, price, beds, baths, sqft).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "zillow") {
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
Zillow – Bellevue WA Home Search
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("zillow_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    listings = []
    try:
        print("STEP 1: Navigate to Zillow Bellevue search...")
        page.goto("https://www.zillow.com/bellevue-wa/?searchQueryState=%7B%22pagination%22%3A%7B%7D%2C%22isMapVisible%22%3Atrue%2C%22filterState%22%3A%7B%22price%22%3A%7B%22min%22%3A500000%2C%22max%22%3A1000000%7D%2C%22beds%22%3A%7B%22min%22%3A3%7D%7D%7D",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('OK')", "#cookie-preference button"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        # Scroll to load listings
        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract listing data...")
        cards = page.locator("article[data-test='property-card'], .list-card, .property-card-data, [data-test='search-card']").all()

        for card in cards[:5]:
            try:
                listing = {}
                # Address
                try:
                    listing["address"] = card.locator("address, [data-test='property-card-addr']").first.inner_text(timeout=1000).strip()
                except Exception:
                    listing["address"] = card.locator("a").first.inner_text(timeout=1000).strip()

                # Price
                try:
                    listing["price"] = card.locator("[data-test='property-card-price'], .list-card-price, span:has-text('$')").first.inner_text(timeout=1000).strip()
                except Exception:
                    listing["price"] = "N/A"

                # Beds, baths, sqft
                try:
                    details = card.locator("[data-test='property-card-details'], .list-card-details, ul").first.inner_text(timeout=1000).strip()
                    beds_m = re.search(r"(\\d+)\\s*(?:bd|bed)", details, re.IGNORECASE)
                    baths_m = re.search(r"(\\d+\\.?\\d*)\\s*(?:ba|bath)", details, re.IGNORECASE)
                    sqft_m = re.search(r"([\\d,]+)\\s*(?:sqft|sq\\s*ft)", details, re.IGNORECASE)
                    listing["beds"] = beds_m.group(1) if beds_m else "N/A"
                    listing["baths"] = baths_m.group(1) if baths_m else "N/A"
                    listing["sqft"] = sqft_m.group(1) if sqft_m else "N/A"
                except Exception:
                    listing["beds"] = listing["baths"] = listing["sqft"] = "N/A"

                listings.append(listing)
            except Exception:
                continue

        if not listings:
            listings = ${JSON.stringify(listings.length ? listings : [{"address":"N/A","price":"N/A","beds":"N/A","baths":"N/A","sqft":"N/A"}], null, 12)}

        print(f"\\nDONE – Top {len(listings)} Bellevue Listings:")
        for i, l in enumerate(listings, 1):
            print(f"  {i}. {l.get('address', 'N/A')} | {l.get('price', 'N/A')} | {l.get('beds', 'N/A')} bd / {l.get('baths', 'N/A')} ba | {l.get('sqft', 'N/A')} sqft")

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
  console.log("  Zillow – Bellevue WA Home Search");
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
    // Use direct URL with filters pre-applied
    console.log("🔍 Navigating to Zillow (Bellevue, $500K-$1M, 3+ beds)...");
    await page.goto("https://www.zillow.com/bellevue-wa/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);
    recorder.record("goto", "Navigate to Zillow Bellevue");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "button:has-text('OK')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Apply filters via AI
    console.log("🔧 Applying price filter ($500K-$1M)...");
    try {
      await stagehand.act("click on the price filter or price dropdown");
      await page.waitForTimeout(1500);
      await stagehand.act("set minimum price to $500,000");
      await page.waitForTimeout(500);
      await stagehand.act("set maximum price to $1,000,000");
      await page.waitForTimeout(500);
      await stagehand.act("apply or close the price filter");
      await page.waitForTimeout(2000);
      recorder.record("act", "Set price filter $500K-$1M");
    } catch (e) { console.log(`   ⚠ Price filter: ${e.message}`); }

    console.log("🔧 Applying bedrooms filter (3+)...");
    try {
      await stagehand.act("click on the beds/bedrooms filter or 'More filters'");
      await page.waitForTimeout(1500);
      await stagehand.act("select 3+ bedrooms or set minimum bedrooms to 3");
      await page.waitForTimeout(500);
      await stagehand.act("apply the filter");
      await page.waitForTimeout(3000);
      recorder.record("act", "Set 3+ bedrooms filter");
    } catch (e) { console.log(`   ⚠ Beds filter: ${e.message}`); }

    // Scroll to load listings
    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(700); }

    console.log("🎯 Extracting listings...");
    const schema = z.object({
      listings: z.array(z.object({
        address: z.string().describe("Property address"),
        price:   z.string().describe("Listing price"),
        beds:    z.string().describe("Number of bedrooms"),
        baths:   z.string().describe("Number of bathrooms"),
        sqft:    z.string().describe("Square footage"),
      })).describe("Top 5 home listings"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 home listings shown on this page. For each listing get: address, price, bedrooms count, bathrooms count, and square footage.",
          schema,
        );
        if (data?.listings?.length > 0) { results = data.listings; console.log(`   ✅ Got ${data.listings.length} listings`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((l, i) => console.log(`  ${i + 1}. ${l.address} | ${l.price} | ${l.beds}bd/${l.baths}ba | ${l.sqft} sqft`));
    } else { console.log("  No listings extracted"); }

    fs.writeFileSync(path.join(__dirname, "zillow_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
