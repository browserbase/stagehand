const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Best Buy – Product Search
 *
 * Searches for "4K monitor" on bestbuy.com, sorts by Customer Rating,
 * and extracts the top 5 products with name, price, and rating.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 *
 * v4 – fully concretized: direct URL for search+sort, pure Playwright
 *       selectors for extraction. Zero AI calls.
 */

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.bestbuy.com",
  searchTerm: "4K monitor",
  sortBy: "Customer Rating",
  maxResults: 5,
  waits: { page: 5000, type: 2000, sort: 5000, extract: 3000 },
};

// Build the search + sort URL directly
function buildSearchUrl(term) {
  const encoded = encodeURIComponent(term);
  // Best Buy search page with sort by customer rating
  return `https://www.bestbuy.com/site/searchpage.jsp?st=${encoded}&sp=%2Bcustomerrating`;
}

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Best Buy – Product Search
Search: "${cfg.searchTerm}", sorted by ${cfg.sortBy}
Extract top ${cfg.maxResults} products with name, price, and customer rating.

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os, sys, shutil
import traceback
from urllib.parse import quote
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright: Playwright,
    search_term: str = "${cfg.searchTerm}",
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  Best Buy – Product Search")
    print("=" * 59)
    print(f"  Search: \\"{search_term}\\"")
    print(f"  Sort by: ${cfg.sortBy}")
    print(f"  Extract up to {max_results} products\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("bestbuy_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate directly to sorted search results ────────────────────
        search_url = f"https://www.bestbuy.com/site/searchpage.jsp?st={quote(search_term)}&sp=%2Bcustomerrating"
        print(f"Loading search results (sorted by ${cfg.sortBy})...")
        print(f"  URL: {search_url}")
        page.goto(search_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(${cfg.waits.page})
        print(f"  Loaded: {page.url}\\n")

        # ── Extract products ──────────────────────────────────────────────
        print(f"Extracting top {max_results} products...\\n")

        # Scroll to load products
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 400)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Best Buy product grid items are .product-list-item
        items = page.locator('.product-list-item')
        count = items.count()
        print(f"  Found {count} product items")

        seen = set()
        for i in range(count):
            if len(results) >= max_results:
                break
            item = items.nth(i)
            try:
                text = item.inner_text(timeout=3000)
                if not text or len(text) < 30:
                    continue

                # Parse product name - skip badge labels
                lines = [l.strip() for l in text.split("\\n") if l.strip()]
                badge_labels = {"sponsored", "best selling", "new", "sale", "top rated",
                                "top deal", "clearance", "open-box", "advertisement"}
                name = None
                for line in lines:
                    if line.lower() in badge_labels:
                        continue
                    if len(line) >= 10:
                        name = line
                        break
                if not name:
                    continue

                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)

                # Price
                price = "N/A"
                import re as _re
                price_match = _re.search(r'\\$[\\d,]+\\.?\\d*', text)
                if price_match:
                    price = price_match.group(0)

                # Rating
                rating = "N/A"
                r_match = _re.search(r'Rating\\s+([\\d.]+)\\s+out\\s+of\\s+5\\s+stars\\s+with\\s+([\\d,]+)\\s+reviews', text, _re.IGNORECASE)
                if r_match:
                    rating = f"{r_match.group(1)} out of 5 ({r_match.group(2)} reviews)"
                else:
                    alt_match = _re.search(r'([\\d.]+)\\s*(?:out of|/)\\s*5', text, _re.IGNORECASE)
                    if alt_match:
                        rating = f"{alt_match.group(1)}/5"

                results.append({
                    "name": name,
                    "price": price,
                    "rating": rating,
                })
            except Exception:
                continue

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} products:\\n")
        for i, prod in enumerate(results, 1):
            print(f"  {i}. {prod['name']}")
            print(f"     Price:  {prod['price']}")
            print(f"     Rating: {prod['rating']}")
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
        print(f"Total products: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  const selectors = [
    "button:has-text('Accept')",
    "button:has-text('Accept All')",
    "button:has-text('Close')",
    "[aria-label='Close']",
    "button.close-button",
    ".modal-close",
    "button:has-text('No Thanks')",
    "button:has-text('No, thanks')",
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first;
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        console.log(`   ✅ Dismissed: ${sel}`);
        await page.waitForTimeout(500);
      }
    } catch (e) { /* not visible */ }
  }
  await page.waitForTimeout(500);
}

async function extractProducts(stagehand, page, recorder) {
  console.log(`🎯 Extracting top ${CFG.maxResults} products...\n`);

  // Scroll to load products
  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 400)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // Pure Playwright extraction using DOM selectors (discovered via DOM inspection)
  // The main grid items are `.product-list-item` which contain name, price, and rating in their innerText
  const products = await page.evaluate((maxResults) => {
    const results = [];

    // Best Buy product grid items
    const items = document.querySelectorAll('.product-list-item');

    const seen = new Set();
    for (let i = 0; i < items.length; i++) {
      if (results.length >= maxResults) break;
      const item = items[i];
      const text = item.innerText;
      if (!text || text.length < 30) continue;

      // Parse product name from innerText
      // Skip badge labels like "Sponsored", "Best Selling", "New", etc.
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const badgeLabels = new Set([
        'sponsored', 'best selling', 'new', 'sale', 'top rated',
        'top deal', 'clearance', 'open-box', 'advertisement',
      ]);
      let name = null;
      for (const line of lines) {
        if (badgeLabels.has(line.toLowerCase())) continue;
        // A product name should be reasonably long and look like a product
        if (line.length >= 10) { name = line; break; }
      }
      if (!name) continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      // Price: find first $X,XXX.XX pattern
      let price = "N/A";
      const priceMatch = text.match(/\$[\d,]+\.?\d*/);
      if (priceMatch) price = priceMatch[0];

      // Customer rating: "Rating X.X out of 5 stars with N reviews"
      let rating = "N/A";
      const ratingMatch = text.match(/Rating\s+([\d.]+)\s+out\s+of\s+5\s+stars\s+with\s+([\d,]+)\s+reviews/i);
      if (ratingMatch) {
        rating = `${ratingMatch[1]} out of 5 (${ratingMatch[2]} reviews)`;
      } else {
        const altMatch = text.match(/([\d.]+)\s*(?:out of|\/)\s*5/i);
        if (altMatch) rating = `${altMatch[1]}/5`;
      }

      results.push({ name, price, rating });
    }
    return results;
  }, CFG.maxResults);

  recorder.record("extract", {
    instruction: "Extract top products via DOM selectors",
    description: `Extract up to ${CFG.maxResults} products with name, price, and rating`,
    results: { products },
  });

  console.log(`📋 Found ${products.length} products:`);
  products.forEach((p, i) => {
    console.log(`   ${i + 1}. ${p.name}`);
    console.log(`      Price:  ${p.price}`);
    console.log(`      Rating: ${p.rating}`);
    console.log();
  });

  return { products };
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Best Buy – Product Search (v4 – fully concretized)");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🔍 Search: "${CFG.searchTerm}"`);
  console.log(`  📊 Sort by: ${CFG.sortBy}`);
  console.log(`  📦 Extract top ${CFG.maxResults} products\n`);

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");
  let stagehand;

  try {
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(
          os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
        ),
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-extensions",
          "--start-maximized",
          "--window-size=1920,1080",
        ],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");

    const page = stagehand.context.pages()[0];

    // ── Step 1+2: Navigate directly to sorted search results ─────────
    const searchUrl = buildSearchUrl(CFG.searchTerm);
    console.log(`🌐 Loading search results (sorted by ${CFG.sortBy})...`);
    console.log(`   URL: ${searchUrl}`);
    recorder.goto(searchUrl);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    recorder.wait(CFG.waits.page, "Wait for search results");
    await page.waitForTimeout(CFG.waits.page);
    console.log(`✅ Loaded: ${page.url()}\n`);

    // Dismiss popups
    await dismissPopups(page);

    // ── Step 3: Extract products ─────────────────────────────────────
    const products = await extractProducts(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${products.products.length} products`);
    console.log("═══════════════════════════════════════════════════════════");
    products.products.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}`);
      console.log(`     Price: ${p.price}  Rating: ${p.rating}`);
    });

    // Save Python script
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "bestbuy_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    // Save recorded actions
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${jsonPath}`);

    return products;

  } catch (err) {
    console.log("\n❌ Error:", err.message);
    console.log("Stack:", err.stack);
    fs.writeFileSync(path.join(__dirname, "error.log"),
      `${new Date().toISOString()}\n${err.message}\n\n${err.stack}`, "utf-8");
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder);
      fs.writeFileSync(path.join(__dirname, "bestbuy_search.py"), pyScript, "utf-8");
      console.log("⚠️  Partial Python saved");
    }
    throw err;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing...");
      await stagehand.close();
    }
  }
}

if (require.main === module) {
  main()
    .then(() => { console.log("🎊 Done!"); process.exit(0); })
    .catch((e) => { console.log("💥", e.message); process.exit(1); });
}
module.exports = { main };
