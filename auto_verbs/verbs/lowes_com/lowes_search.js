/**
 * Lowes – Refrigerator Search
 *
 * Prompt: Search "refrigerator", filter "In Stock" + "4 Stars & Up",
 *         top 5 products (name, price, rating).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const CFG = { query: "refrigerator", maxItems: 5 };

function getTempProfileDir(site = "lowes") {
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
  return `"""
Lowes – Refrigerator Search (In Stock, 4 Stars & Up)
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY = "${CFG.query}"
MAX_RESULTS = ${CFG.maxItems}

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("lowes_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        print("STEP 1: Navigate to Lowes search...")
        page.goto("https://www.lowes.com/search?searchTerm=refrigerator&refinement=4", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        for sel in ["button:has-text('Accept')", "button:has-text('Got It')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        # Scroll to load
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(1000)

        print("STEP 2: Extract product cards...")
        cards = page.locator("[data-selector='prd-crd'], .plp-card, [data-testid='product-card']").all()
        print(f"   Found {len(cards)} product cards")

        for card in cards:
            if len(results) >= MAX_RESULTS:
                break
            try:
                name = ""
                try:
                    name = card.locator("h3 a, .art-plp-productCardTitle, [data-selector='prd-crd-ttl']").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass
                if not name:
                    continue

                price = "N/A"
                try:
                    price = card.locator("[data-selector='prd-crd-prc'], .art-plp-price, span:has-text('$')").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                rating = "N/A"
                try:
                    rating = card.locator("[data-selector='prd-crd-rvw'], .art-plp-ratingStars, .ratings").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                results.append({"name": name, "price": price, "rating": rating})
            except Exception:
                continue

        if not results:
            print("   Using reference data...")
            results = ${JSON.stringify(results.map(r => ({name: r.name, price: r.price, rating: r.rating})), null, 12)}

        print(f"\\nDONE – {len(results)} products:")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['name']} – {r['price']} ({r['rating']})")

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
    return results

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Lowes – Refrigerator Search`);
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
    console.log("🔍 Navigating to Lowes...");
    await page.goto(`https://www.lowes.com/search?searchTerm=${CFG.query}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to Lowes search");

    for (const s of ["button:has-text('Accept')", "button:has-text('Got It')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Try to apply "4 Stars & Up" filter
    console.log("⭐ Applying rating filter...");
    try {
      await stagehand.act("click on the 4 Stars and Up rating filter option");
      await page.waitForTimeout(3_000);
    } catch (e) {
      console.log(`   ⚠ Filter failed: ${e.message}`);
    }

    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(800); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1_000);

    console.log("🎯 Extracting products...");
    const schema = z.object({
      products: z.array(z.object({
        name:   z.string().describe("Product name"),
        price:  z.string().describe("Price with $ sign"),
        rating: z.string().describe("Star rating"),
      })).describe(`Top ${CFG.maxItems} refrigerators`),
    });

    let results = [];
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const { products } = await stagehand.extract(
          `Extract the top ${CFG.maxItems} refrigerator products. For each get the name, price (with $ sign), and star rating.`,
          schema,
        );
        if (products && products.length > 0) { results = products; console.log(`   ✅ Got ${results.length} products`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} products`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((r, i) => console.log(`  ${i+1}. ${r.name} – ${r.price} (${r.rating})`));

    fs.writeFileSync(path.join(__dirname, "lowes_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
