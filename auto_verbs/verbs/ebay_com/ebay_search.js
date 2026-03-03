/**
 * eBay – Vintage Mechanical Keyboard Search
 *
 * Prompt:
 *   Search "vintage mechanical keyboard", filter "Buy It Now",
 *   sort "Price + Shipping: lowest first", top 5 (title, price, shipping).
 *
 * Strategy:
 *   Direct URL with params: ebay.com/sch/i.html?_nkw=vintage+mechanical+keyboard&LH_BIN=1&_sop=15
 *   _sop=15 = Price + Shipping: lowest first
 *   LH_BIN=1 = Buy It Now
 *   Then AI extract + record selectors for Python.
 */

const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder, observeAndAct } = require("../../stagehand-utils");

/* ── kill switch ─────────────────────────────────────────── */
const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout – exiting"); process.exit(1); }, TIMEOUT);

/* ── config ──────────────────────────────────────────────── */
const CFG = {
  query:    "vintage mechanical keyboard",
  maxItems: 5,
  url() {
    return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(this.query)}&LH_BIN=1&_sop=15`;
  },
};

/* ── temp Chrome profile ─────────────────────────────────── */
function getTempProfileDir(site = "ebay") {
  const tmp = path.join(os.tmpdir(), `${site}_chrome_profile_${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const src = path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default");
  for (const f of ["Preferences", "Local State"]) {
    const s = path.join(src, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(tmp, f));
  }
  return tmp;
}

/* ── genPython ───────────────────────────────────────────── */
function genPython(results) {
  const ts = new Date().toISOString();
  return `"""
eBay – Vintage Mechanical Keyboard Search
Search: "${CFG.query}" | Filter: Buy It Now | Sort: Price + Shipping lowest
Generated: ${ts}

Pure Playwright – no AI. Uses .s-item CSS class selectors discovered via exploration.
"""

import re
import os
import traceback
from playwright.sync_api import Playwright, sync_playwright

QUERY = "${CFG.query}"
MAX_RESULTS = ${CFG.maxItems}
URL = "https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(CFG.query)}&LH_BIN=1&_sop=15"


def dismiss_popups(page):
    """Dismiss cookie / GDPR popups."""
    for sel in [
        "#gdpr-banner-accept",
        "button:has-text('Accept')",
        "button:has-text('Accept All')",
        "button:has-text('Got it')",
        "button:has-text('OK')",
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
    print("  eBay – Vintage Mechanical Keyboard Search")
    print("=" * 60)
    print(f'  Query: "{search_query}"')
    print(f"  Filter: Buy It Now | Sort: Price + Shipping lowest")
    print(f"  Max results: {max_results}\\n")

    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport={"width": 1280, "height": 900},
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        print("STEP 1: Navigate to eBay search results...")
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(3000)
        dismiss_popups(page)
        print(f"   Loaded: {page.url}\\n")

        print("STEP 2: Extract product listings...")
        # eBay uses .s-item class for each listing card
        items = page.locator("li.s-item, div.s-item__wrapper").all()
        print(f"   Found {len(items)} .s-item elements")

        for item in items:
            if len(results) >= max_results:
                break
            try:
                # Title: .s-item__title
                title_el = item.locator(".s-item__title").first
                title = title_el.inner_text(timeout=2000).strip() if title_el.is_visible(timeout=500) else ""

                # Skip placeholder/header items
                if not title or title.lower().startswith("shop on ebay") or len(title) < 5:
                    continue

                # Price: .s-item__price
                price = ""
                try:
                    price_el = item.locator(".s-item__price").first
                    price = price_el.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                # Shipping: .s-item__shipping or .s-item__freeXDays
                shipping = "N/A"
                try:
                    ship_el = item.locator(".s-item__shipping, .s-item__freeXDays").first
                    shipping = ship_el.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                results.append({
                    "title": title,
                    "price": price,
                    "shipping": shipping,
                })
            except Exception:
                continue

        print(f"\\n" + "=" * 60)
        print(f"  DONE – {len(results)} results")
        print("=" * 60)
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['title']}")
            print(f"     Price:    {r['price']}")
            print(f"     Shipping: {r['shipping']}")
            print()

    except Exception as e:
        print(f"\\nError: {e}")
        traceback.print_exc()
    finally:
        context.close()

    return results


if __name__ == "__main__":
    with sync_playwright() as playwright:
        items = run(playwright)
        print(f"Total results: {len(items)}")
`;
}

/* ── popup dismissal ─────────────────────────────────────── */
async function dismissPopups(page) {
  const sels = [
    "#gdpr-banner-accept",
    "button:has-text('Accept')",
    "button:has-text('Accept All')",
    "button:has-text('Got it')",
    "button:has-text('OK')",
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

/* ── search (direct URL) ────────────────────────────────── */
async function searchEbay(stagehand, page, recorder) {
  console.log(`\n🔍 Searching eBay for "${CFG.query}"...`);
  console.log(`   URL: ${CFG.url()}`);

  await page.goto(CFG.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  recorder.record("goto", `Navigate to ${CFG.url()}`);

  await page.waitForTimeout(3_000);
  recorder.record("wait", "Wait for eBay search results");

  console.log(`   ✅ Results loaded: ${page.url()}`);
}

/* ── extract ─────────────────────────────────────────────── */
async function extractResults(stagehand, page, recorder) {
  console.log("🎯 Extracting top 5 results...\n");

  const schema = z.object({
    items: z.array(z.object({
      title:    z.string().describe("Product title"),
      price:    z.string().describe("Price with $ sign"),
      shipping: z.string().describe("Shipping cost or 'Free shipping'"),
    })).describe(`Top ${CFG.maxItems} vintage mechanical keyboards`),
  });

  const MAX_TRIES = 3;
  for (let t = 1; t <= MAX_TRIES; t++) {
    console.log(`   Attempt ${t}: Extracting...`);
    try {
      const { items } = await stagehand.extract(
        `Extract the top ${CFG.maxItems} product listings. For each, get the title, price (with $ sign), and shipping cost. Skip any "Shop on eBay" header items.`,
        schema,
      );
      if (items && items.length > 0) {
        console.log(`   ✅ Extracted ${items.length} results on attempt ${t}`);
        recorder.record("extract", `Extract top ${CFG.maxItems} items (title, price, shipping)`);
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

  console.log("   ❌ Extraction failed after retries");
  return [];
}

/* ── main ────────────────────────────────────────────────── */
(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  eBay – Vintage Mechanical Keyboard Search");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  ⌨️  Search: "${CFG.query}"`);
  console.log(`  📊 Sort: Price + Shipping lowest | Filter: Buy It Now`);
  console.log(`  📦 Extract up to ${CFG.maxItems} results\n`);

  console.log("🤖 Setting up GitHub Models API...");
  const llmClient = setupLLMClient("hybrid");
  console.log("✅ GitHub Models API ready\n");

  console.log("🎭 Initializing Stagehand...");
  const tmpProfile = getTempProfileDir();
  console.log(`📁 Temp profile: ${tmpProfile}`);

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    llmClient,
    localBrowserLaunchOptions: {
      headless: false,
      args: [
        `--user-data-dir=${tmpProfile}`,
        "--disable-blink-features=AutomationControlled",
      ],
    },
  });
  await stagehand.init();
  console.log("✅ Stagehand ready\n");

  const page = stagehand.context.pages()[0];
  const recorder = new PlaywrightRecorder();

  try {
    await searchEbay(stagehand, page, recorder);

    console.log("🔲 Dismissing popups...");
    await dismissPopups(page);

    await page.evaluate(() => window.scrollBy(0, 300));
    await page.waitForTimeout(1_500);

    const results = await extractResults(stagehand, page, recorder);

    console.log(`📋 Found ${results.length} results:`);
    results.forEach((r, i) => {
      console.log(`   ${i + 1}. ${r.title}`);
      console.log(`      Price:    ${r.price}`);
      console.log(`      Shipping: ${r.shipping}\n`);
    });

    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} results`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.title}`);
      console.log(`     Price:    ${r.price}`);
      console.log(`     Shipping: ${r.shipping}`);
    });

    // genPython disabled — ebay_search.py is hand-optimized (page.evaluate + temp profile)
    // const pyPath = path.join(__dirname, "ebay_search.py");
    // fs.writeFileSync(pyPath, genPython(results), "utf-8");
    // console.log(`\n✅ Python saved: ${pyPath}`);

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
