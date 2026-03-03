/**
 * Etsy – Handmade Ceramic Mug Search
 *
 * Prompt:
 *   Search "handmade ceramic mug", sort "Top Customer Reviews",
 *   top 5 (title, price, seller name).
 *
 * Strategy:
 *   Direct URL: etsy.com/search?q=handmade+ceramic+mug&order=highest_reviews
 *   Then AI extract the listings.
 */

const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder, observeAndAct } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout – exiting"); process.exit(1); }, TIMEOUT);

const CFG = {
  query: "handmade ceramic mug",
  maxItems: 5,
  url() {
    return `https://www.etsy.com/search?q=${encodeURIComponent(this.query)}&order=highest_reviews`;
  },
};

function getTempProfileDir(site = "etsy") {
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
Etsy – Handmade Ceramic Mug Search
Search: "${CFG.query}" | Sort: Top Customer Reviews
Generated: ${ts}

Pure Playwright – no AI. Uses Etsy listing card selectors.
"""

import re
import os, sys, shutil
import traceback
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY = "${CFG.query}"
MAX_RESULTS = ${CFG.maxItems}
URL = "https://www.etsy.com/search?q=${encodeURIComponent(CFG.query)}&order=highest_reviews"


def dismiss_popups(page):
    for sel in [
        "button:has-text('Accept')",
        "button:has-text('Accept All')",
        "button:has-text('Got it')",
        "button:has-text('OK')",
        "#gdpr-single-choice-approve",
    ]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=800):
                loc.evaluate("el => el.click()")
                page.wait_for_timeout(300)
        except Exception:
            pass


def run(
    playwright: Playwright,
    search_query: str = QUERY,
    max_results: int = MAX_RESULTS,
) -> list:
    print("=" * 60)
    print("  Etsy – Handmade Ceramic Mug Search")
    print("=" * 60)
    print(f'  Query: "{search_query}"')
    print(f"  Sort: Top Customer Reviews")
    print(f"  Max results: {max_results}\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("etsy_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        print("STEP 1: Navigate to Etsy search results...")
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        dismiss_popups(page)
        print(f"   Loaded: {page.url}\\n")

        print("STEP 2: Extract listings...")
        # Etsy uses data-search-results with listing cards
        # Each listing has a .v2-listing-card structure
        cards = page.locator("[data-search-results] .v2-listing-card, .search-listing-card, [data-listing-id]").all()
        print(f"   Found {len(cards)} listing cards")

        if not cards or len(cards) == 0:
            # Fallback: parse body text
            print("   Fallback: parsing body text...")
            text = page.inner_text("body")
            lines = [l.strip() for l in text.splitlines() if l.strip()]
            i = 0
            while i < len(lines) and len(results) < max_results:
                price_match = re.match(r'^\\$(\\d+\\.\\d{2})', lines[i])
                if price_match and i > 0:
                    # Look back for title
                    title = None
                    for back in range(i - 1, max(i - 4, -1), -1):
                        c = lines[back]
                        if len(c) > 10 and not c.startswith('$') and 'Ad by' not in c:
                            title = c
                            break
                    if title:
                        # Look for seller nearby
                        seller = "N/A"
                        for near in range(i, min(i + 5, len(lines))):
                            if lines[near].startswith("Ad by ") or lines[near].startswith("By "):
                                seller = lines[near].replace("Ad by ", "").replace("By ", "")
                                break
                        results.append({
                            "title": title,
                            "price": "$" + price_match.group(1),
                            "seller": seller,
                        })
                i += 1
        else:
            for card in cards:
                if len(results) >= max_results:
                    break
                try:
                    # Title from the card link or h3
                    title = ""
                    try:
                        title_el = card.locator("h3, .v2-listing-card__title, [data-listing-card-title]").first
                        title = title_el.inner_text(timeout=1000).strip()
                    except Exception:
                        try:
                            title_el = card.locator("a").first
                            title = title_el.get_attribute("title") or ""
                        except Exception:
                            pass

                    if not title or len(title) < 5:
                        continue

                    # Price
                    price = "N/A"
                    try:
                        price_el = card.locator(".currency-value, .lc-price, span.currency-value").first
                        price = "$" + price_el.inner_text(timeout=1000).strip()
                    except Exception:
                        pass

                    # Seller / Shop name
                    seller = "N/A"
                    try:
                        shop_el = card.locator(".shop-name, .v2-listing-card__shop, [data-shop-name]").first
                        seller = shop_el.inner_text(timeout=1000).strip()
                    except Exception:
                        pass

                    results.append({
                        "title": title,
                        "price": price,
                        "seller": seller,
                    })
                except Exception:
                    continue

        print(f"\\n" + "=" * 60)
        print(f"  DONE – {len(results)} results")
        print("=" * 60)
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['title']}")
            print(f"     Price:  {r['price']}")
            print(f"     Seller: {r['seller']}")
            print()

    except Exception as e:
        print(f"\\nError: {e}")
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
        items = run(playwright)
        print(f"Total results: {len(items)}")
`;
}

async function dismissPopups(page) {
  const sels = [
    "button:has-text('Accept')",
    "button:has-text('Accept All')",
    "button:has-text('Got it')",
    "button:has-text('OK')",
    "#gdpr-single-choice-approve",
  ];
  for (const s of sels) {
    try {
      const el = page.locator(s).first();
      if (await el.isVisible({ timeout: 600 })) {
        await el.click({ timeout: 1_000 });
        await page.waitForTimeout(300);
      }
    } catch {}
  }
}

async function searchEtsy(stagehand, page, recorder) {
  console.log(`\n🔍 Searching Etsy for "${CFG.query}"...`);
  // Go to homepage first to appear more natural
  await page.goto("https://www.etsy.com", { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForTimeout(3_000);
  recorder.record("goto", "Navigate to etsy.com");

  // Use the search bar 
  try {
    const searchInput = page.locator('#global-enhancements-search-query, input[name="search_query"]').first();
    await searchInput.click({ timeout: 5_000 });
    await page.waitForTimeout(500);
    await searchInput.fill(CFG.query);
    await page.waitForTimeout(500);
    await page.keyboard.press("Enter");
    recorder.record("search", `Search for "${CFG.query}"`);
    await page.waitForTimeout(5_000);
  } catch (e) {
    console.log(`   ⚠ Search bar failed, using direct URL: ${e.message}`);
    await page.goto(CFG.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);
  }

  // Scroll down to trigger lazy load
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.scrollBy(0, 500));
    await page.waitForTimeout(1_000);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1_500);

  recorder.record("wait", "Wait for Etsy search results");
  console.log(`   ✅ Results loaded: ${page.url()}`);
}

async function extractResults(stagehand, page, recorder) {
  console.log("🎯 Extracting top 5 results...\n");

  const schema = z.object({
    items: z.array(z.object({
      title:  z.string().describe("Product title"),
      price:  z.string().describe("Price with $ sign"),
      seller: z.string().describe("Seller / shop name"),
    })).describe(`Top ${CFG.maxItems} handmade ceramic mugs`),
  });

  const MAX_TRIES = 3;
  for (let t = 1; t <= MAX_TRIES; t++) {
    console.log(`   Attempt ${t}: Extracting...`);
    try {
      const { items } = await stagehand.extract(
        `Extract the top ${CFG.maxItems} product listings. For each, get the title, price (with $ sign), and seller/shop name. Skip any ads.`,
        schema,
      );
      if (items && items.length > 0) {
        console.log(`   ✅ Extracted ${items.length} results on attempt ${t}`);
        recorder.record("extract", `Extract top ${CFG.maxItems} items`);
        return items;
      }
    } catch (e) {
      console.log(`   ⚠ Attempt ${t} error: ${e.message}`);
    }
    if (t < MAX_TRIES) {
      await page.evaluate(() => window.scrollBy(0, 600));
      await page.waitForTimeout(2_000);
    }
  }
  return [];
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Etsy – Handmade Ceramic Mug Search");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🍵 Search: "${CFG.query}"`);
  console.log(`  📊 Sort: Top Customer Reviews`);
  console.log(`  📦 Extract up to ${CFG.maxItems} results\n`);

  console.log("🤖 Setting up GitHub Models API...");
  const llmClient = setupLLMClient("hybrid");
  console.log("✅ GitHub Models API ready\n");

  console.log("🎭 Initializing Stagehand...");
  const tmpProfile = getTempProfileDir();
  console.log(`📁 Temp profile: ${tmpProfile}`);

  const stagehand = new Stagehand({
    env: "LOCAL", verbose: 0, llmClient,
    localBrowserLaunchOptions: {
      headless: false,
      args: [`--user-data-dir=${tmpProfile}`, "--disable-blink-features=AutomationControlled"],
    },
  });
  await stagehand.init();
  console.log("✅ Stagehand ready\n");

  const page = stagehand.context.pages()[0];
  const recorder = new PlaywrightRecorder();

  try {
    await searchEtsy(stagehand, page, recorder);
    console.log("🔲 Dismissing popups...");
    await dismissPopups(page);
    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(1_500);

    const results = await extractResults(stagehand, page, recorder);

    console.log(`📋 Found ${results.length} results:`);
    results.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.title}`);
      console.log(`      Price:  ${r.price}`);
      console.log(`      Seller: ${r.seller}\n`);
    });

    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} results`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.title}`);
      console.log(`     Price:  ${r.price}`);
      console.log(`     Seller: ${r.seller}`);
    });

    const pyPath = path.join(__dirname, "etsy_search.py");
    fs.writeFileSync(pyPath, genPython(results), "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    const actPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(actPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${actPath}`);
  } finally {
    console.log("\n🧹 Closing...");
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
