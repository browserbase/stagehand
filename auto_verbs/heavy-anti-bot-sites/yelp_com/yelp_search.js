const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Yelp – Coffee Shop Search
 *
 * Uses AI-driven discovery to search Yelp for "best coffee shops" in
 * "Portland, OR", sort by "Highest Rated", and extract the top 5 with
 * name, rating, number of reviews, and price range.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Hard kill switch ─────────────────────────────────────────────────────────
const GLOBAL_TIMEOUT_MS = 150_000;
const _killTimer = setTimeout(() => {
  console.error("\n⏱️  Global timeout reached — force-exiting.");
  process.exit(2);
}, GLOBAL_TIMEOUT_MS);
_killTimer.unref();

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.yelp.com",
  searchTerm: "best coffee shops",
  location: "Portland, OR",
  sortBy: "Highest Rated",
  maxResults: 5,
  waits: { page: 4000, type: 1500, search: 6000 },
};

// ── Temp Profile Helper ──────────────────────────────────────────────────────
function getTempProfileDir() {
  const src = path.join(
    os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
  );
  const tmp = path.join(os.tmpdir(), `yelp_chrome_profile_${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  for (const file of ["Preferences", "Local State"]) {
    const srcFile = path.join(src, file);
    if (fs.existsSync(srcFile)) {
      try { fs.copyFileSync(srcFile, path.join(tmp, file)); } catch (_) {}
    }
  }
  console.log(`📁 Temp profile: ${tmp}`);
  return tmp;
}

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder, extractedResults) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
Yelp – Coffee Shop Search
Search: "${cfg.searchTerm}" in "${cfg.location}"
Sort by: ${cfg.sortBy}
Extract up to ${cfg.maxResults} results with name, rating, reviews, price range.

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os, sys, shutil
import re
import traceback
from urllib.parse import quote_plus
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright: Playwright,
    search_term: str = "${cfg.searchTerm}",
    location: str = "${cfg.location}",
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  Yelp – Coffee Shop Search")
    print("=" * 59)
    print(f'  Search: "{search_term}" in "{location}"')
    print(f"  Sort by: ${cfg.sortBy}")
    print(f"  Extract up to {max_results} results\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("yelp_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate directly to search results ───────────────────────
        search_url = f"https://www.yelp.com/search?find_desc={quote_plus(search_term)}&find_loc={quote_plus(location)}&sortby=rating"
        print(f"Loading: {search_url}")
        page.goto(search_url, timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\\n")

        # ── Dismiss popups ────────────────────────────────────────────
        for sel in [
            "#onetrust-accept-btn-handler",
            "button:has-text('Accept All')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Scroll to load content ────────────────────────────────────
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # ── Extract results ───────────────────────────────────────────
        print(f"Extracting up to {max_results} results...\\n")

        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\\n") if l.strip()]

        i = 0
        while i < len(lines) and len(results) < max_results:
            line = lines[i]
            # Look for numbered results pattern: "1. Name" or just business card-like entries
            num_match = re.match(r'^(\\d+)\\.\\s+(.+)$', line)
            if num_match:
                name = num_match.group(2).strip()
                shop = {
                    "name": name,
                    "rating": "N/A",
                    "reviews": "N/A",
                    "price_range": "N/A",
                }
                # Look ahead for rating, reviews, price
                for j in range(i + 1, min(len(lines), i + 12)):
                    cand = lines[j].strip()
                    cl = cand.lower()
                    # Rating (e.g. "4.5" or "4.5 star rating")
                    if re.match(r'^\\d\\.\\d$', cand) and shop["rating"] == "N/A":
                        shop["rating"] = cand
                        continue
                    # Reviews (e.g. "123 reviews" or "(123)")
                    rev_match = re.search(r'(\\d+)\\s*reviews?', cl)
                    if rev_match and shop["reviews"] == "N/A":
                        shop["reviews"] = rev_match.group(1)
                        continue
                    # Price range (e.g. "$$" or "$$$")
                    if re.match(r'^\\${1,4}$', cand):
                        shop["price_range"] = cand
                        continue

                if shop["name"] not in [r["name"] for r in results]:
                    results.append(shop)
            i += 1

        # ── Print results ─────────────────────────────────────────────
        print(f"\\nFound {len(results)} coffee shops:\\n")
        for i, s in enumerate(results, 1):
            print(f"  {i}. {s['name']}")
            print(f"     Rating:     {s['rating']}")
            print(f"     Reviews:    {s['reviews']}")
            print(f"     Price:      {s['price_range']}")
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

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  const selectors = [
    "#onetrust-accept-btn-handler",
    "button.onetrust-close-btn-handler",
    "button:has-text('Accept All')",
    "button:has-text('Accept')",
    "button:has-text('Got it')",
    "button:has-text('OK')",
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        console.log(`   ✅ Dismissed: ${sel}`);
        await page.waitForTimeout(500);
      }
    } catch (e) { /* not visible */ }
  }
  await page.waitForTimeout(500);
}

async function searchYelp(stagehand, page, recorder) {
  console.log(`🔍 Searching Yelp for "${CFG.searchTerm}" in "${CFG.location}"...`);

  // Navigate directly to Yelp search results sorted by rating
  const searchUrl = `https://www.yelp.com/search?find_desc=${encodeURIComponent(CFG.searchTerm)}&find_loc=${encodeURIComponent(CFG.location)}&sortby=rating`;
  console.log(`   Loading: ${searchUrl}`);
  recorder.goto(searchUrl);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  recorder.wait(CFG.waits.search, "Wait for Yelp search results");
  await page.waitForTimeout(CFG.waits.search);
  console.log(`   ✅ Search results loaded: ${page.url()}\n`);

  await dismissPopups(page);
}

async function extractResults(stagehand, page, recorder) {
  console.log(`🎯 Extracting top ${CFG.maxResults} results...\n`);
  const { z } = require("zod/v3");

  const schema = z.object({
    shops: z.array(z.object({
      name: z.string().describe("Business/coffee shop name"),
      rating: z.string().describe("Star rating (e.g. '4.5')"),
      reviews: z.string().describe("Number of reviews (e.g. '234')"),
      priceRange: z.string().describe("Price range indicator (e.g. '$$' or '$')"),
    })).describe(`Top ${CFG.maxResults} coffee shops sorted by highest rated`),
  });

  const instruction = `Extract the top ${CFG.maxResults} business results from this Yelp search results page for "${CFG.searchTerm}" in "${CFG.location}". For each result get: (1) the business name, (2) the star rating, (3) the number of reviews, (4) the price range (like $, $$, $$$). The results are sorted by highest rated. Return exactly ${CFG.maxResults} results.`;

  // Scroll to load content
  for (let i = 0; i < 4; i++) {
    await page.evaluate("window.scrollBy(0, 500)");
    await page.waitForTimeout(400);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  let data = { shops: [] };
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Attempt ${attempt}: Extracting...`);
    try {
      data = await stagehand.extract(instruction, schema);
      if (data.shops.length >= CFG.maxResults) {
        console.log(`   ✅ Extracted ${data.shops.length} results on attempt ${attempt}`);
        break;
      }
      console.log(`   ⚠️  Attempt ${attempt}: only ${data.shops.length} results, retrying...`);
      await page.evaluate("window.scrollBy(0, 500)");
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log(`   ⚠️  Attempt ${attempt} failed: ${e.message}`);
    }
  }

  recorder.record("extract", {
    instruction: "Extract coffee shops via AI",
    description: `Extract top ${CFG.maxResults} shops with name, rating, reviews, price range`,
    results: data,
  });

  console.log(`📋 Found ${data.shops.length} results:`);
  data.shops.forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.name}`);
    console.log(`      Rating:  ${s.rating}`);
    console.log(`      Reviews: ${s.reviews}`);
    console.log(`      Price:   ${s.priceRange}`);
    console.log();
  });

  return data.shops;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Yelp – Coffee Shop Search");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  ☕ Search: "${CFG.searchTerm}" in "${CFG.location}"`);
  console.log(`  📊 Sort by: ${CFG.sortBy}`);
  console.log(`  📦 Extract up to ${CFG.maxResults} results\n`);

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");
  let stagehand;

  try {
    console.log("🎭 Initializing Stagehand...");
    const tempProfile = getTempProfileDir();
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      llmClient,
      localBrowserLaunchOptions: {
        userDataDir: tempProfile,
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-extensions",
          "--no-first-run",
          "--no-default-browser-check",
          "--disable-background-networking",
          "--start-maximized",
          "--window-size=1920,1080",
        ],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");

    const page = stagehand.context.pages()[0];

    await searchYelp(stagehand, page, recorder);
    const shops = await extractResults(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${shops.length} results`);
    console.log("═══════════════════════════════════════════════════════════");
    shops.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.name}`);
      console.log(`     Rating:  ${s.rating}`);
      console.log(`     Reviews: ${s.reviews}`);
      console.log(`     Price:   ${s.priceRange}`);
    });

    const pyScript = genPython(CFG, recorder, shops);
    const pyPath = path.join(__dirname, "yelp_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${jsonPath}`);

    return shops;
  } catch (err) {
    console.error("❌ Fatal error:", err.message);
    throw err;
  } finally {
    if (stagehand) {
      console.log("\n🧹 Closing...");
      try { await stagehand.close(); } catch (_) {}
    }
    console.log("🎊 Done!");
  }
}

main().catch(console.error).finally(() => clearTimeout(_killTimer));
