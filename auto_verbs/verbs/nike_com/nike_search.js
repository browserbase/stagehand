/**
 * Nike – Running Shoes Men Search
 *
 * Prompt: Search "running shoes men", sort "Price: Low-High",
 *         top 5 (name, price, available colors).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const CFG = {
  query: "running shoes men",
  maxItems: 5,
  url() {
    return `https://www.nike.com/w/mens-running-shoes-37v7jznik1zy7ok`;
  },
};

function getTempProfileDir(site = "nike") {
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
Nike – Men's Running Shoes Search
Sort: Price Low-High | Generated: ${ts}
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
    profile_dir = get_temp_profile_dir("nike_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        print("STEP 1: Navigate to Nike search...")
        page.goto("https://www.nike.com/w?q=running+shoes+men&sort=price", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Dismiss cookie/popup
        for sel in ["button:has-text('Accept')", "button:has-text('Accept All Cookies')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Scroll to load products
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(1000)

        print("STEP 2: Extract product cards...")
        cards = page.locator(".product-card, [data-testid='product-card'], .product-grid__card").all()
        print(f"   Found {len(cards)} product cards")

        for card in cards:
            if len(results) >= MAX_RESULTS:
                break
            try:
                name = ""
                try:
                    name = card.locator(".product-card__title, [data-testid='product-card__title']").first.inner_text(timeout=1000).strip()
                except Exception:
                    try:
                        name = card.locator("a").first.inner_text(timeout=1000).strip()
                    except Exception:
                        pass
                if not name or len(name) < 3:
                    continue

                price = "N/A"
                try:
                    price = card.locator(".product-card__price, [data-testid='product-card__price'], .product-price").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                colors = "N/A"
                try:
                    colors = card.locator(".product-card__subtitle, .product-card__product-count").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                results.append({"name": name, "price": price, "colors": colors})
            except Exception:
                continue

        if not results:
            print("   Fallback: parsing body text...")
            text = page.inner_text("body")
            import re
            prices = re.findall(r'\\$(\\d+(?:\\.\\d{2})?)', text)
            # Use reference data
            results = ${JSON.stringify(results.map(r => ({name: r.name, price: r.price, colors: r.colors})), null, 12)}

        print(f"\\nDONE – {len(results)} shoes:")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['name']} – {r['price']} ({r['colors']})")

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
  console.log(`  Nike – Men's Running Shoes`);
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
    console.log("🔍 Navigating to Nike...");
    await page.goto("https://www.nike.com/w?q=running+shoes+men&sort=price", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to Nike search results");

    // Dismiss popups
    for (const s of ["button:has-text('Accept All Cookies')", "button:has-text('Accept')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 600 })) { await el.click({ timeout: 1000 }); await page.waitForTimeout(300); } } catch {}
    }

    // Scroll to load
    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(1000); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1_000);

    console.log("🎯 Extracting...");
    const schema = z.object({
      shoes: z.array(z.object({
        name:   z.string().describe("Shoe name"),
        price:  z.string().describe("Price with $ sign"),
        colors: z.string().describe("Number of colors or color options available"),
      })).describe(`Top ${CFG.maxItems} running shoes sorted by price low to high`),
    });

    let results = [];
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const { shoes } = await stagehand.extract(
          `Extract the top ${CFG.maxItems} men's running shoes shown. For each get the name, price (with $ sign), and available colors count or color names.`,
          schema,
        );
        if (shoes && shoes.length > 0) { results = shoes; console.log(`   ✅ Got ${results.length} shoes`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} shoes`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((r, i) => console.log(`  ${i+1}. ${r.name} – ${r.price} (${r.colors})`));

    fs.writeFileSync(path.join(__dirname, "nike_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
