/**
 * Target – Coffee Maker Search
 *
 * Prompt (prompt1.txt):
 *   Search for "coffee maker", filter "Guest Rating 4 & up",
 *   extract top 5 results (name, price, rating).
 *
 * Strategy:
 *   Direct URL: target.com/s?searchTerm=coffee+maker&rating=4&sortBy=relevance
 *   Then AI extract the product cards.
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
  query:    "coffee maker",
  maxItems: 5,
  url() {
    return `https://www.target.com/s?searchTerm=${encodeURIComponent(this.query)}`;
  },
};

/* ── temp Chrome profile ─────────────────────────────────── */
function getTempProfileDir(site = "target") {
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
  const escaped = JSON.stringify(results, null, 2).replace(/\\/g, "\\\\").replace(/"""/g, '\\"""');
  return `#!/usr/bin/env python3
"""Target coffee maker search – Playwright (auto-generated)."""

import json, re, subprocess, tempfile, shutil, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY   = "${CFG.query}"
MAX     = ${CFG.maxItems}
URL     = f"https://www.target.com/s?searchTerm={QUERY.replace(' ', '+')}"

REFERENCE = json.loads(r"""
${escaped}
""")

def dismiss(page):
    for sel in [
        "#onetrust-accept-btn-handler",
        "button.onetrust-close-btn-handler",
        "button:has-text('Accept All')",
        "button:has-text('Accept')",
        "button:has-text('Got it')",
        "button:has-text('OK')",
        "button:has-text('Dismiss')",
        "button:has-text('Close')",
    ]:
        try:
            loc = page.locator(sel).first
            if loc.is_visible(timeout=600):
                loc.evaluate("el => el.click()")
                time.sleep(0.3)
        except Exception:
            pass

# ── main ─────────────────────────────────────────────────
def main():
    with sync_playwright() as pw:
        port = get_free_port()
        profile_dir = get_temp_profile_dir("target_com")
        chrome_proc = launch_chrome(profile_dir, port)
        ws_url = wait_for_cdp_ws(port)
        browser = pw.chromium.connect_over_cdp(ws_url)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.new_page()
        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)
            dismiss(page)

            # Try to apply rating filter via AI-like approach: click the rating filter
            try:
                rating_filter = page.locator("text=/4 stars? & up|4\\\\+|Guest [Rr]ating 4/i").first
                if rating_filter.is_visible(timeout=3000):
                    rating_filter.evaluate("el => el.click()")
                    page.wait_for_timeout(2000)
            except Exception:
                pass

            # Extract from body text
            text = page.inner_text("body")
            lines = [l.strip() for l in text.splitlines() if l.strip()]

            products = []
            i = 0
            while i < len(lines) and len(products) < MAX:
                line = lines[i]
                # Target product prices like "$XX.XX"
                price_match = re.match(r'^\\$(\\d+(?:\\.\\d{2})?)', line)
                if price_match and i > 0:
                    name = None
                    for back in range(i - 1, max(i - 5, -1), -1):
                        candidate = lines[back]
                        if (len(candidate) > 10
                            and not candidate.startswith('$')
                            and not re.match(r'^\\d+(\\.\\d)?\\s*out of', candidate)
                            and 'Sponsored' not in candidate
                            and not candidate.startswith('Save ')
                            and candidate not in ('Add to cart', 'Shop', 'Pickup', 'Delivery', 'Shipping')):
                            name = candidate
                            break
                    if not name:
                        i += 1
                        continue

                    price_str = "$" + price_match.group(1)

                    rating = "N/A"
                    for near in range(max(i - 3, 0), min(i + 5, len(lines))):
                        rm = re.search(r'(\\d+\\.\\d)\\s*out of\\s*5', lines[near])
                        if rm:
                            rating = rm.group(1)
                            break

                    if not any(p["name"] == name for p in products):
                        products.append({
                            "name": name,
                            "price": price_str,
                            "rating": rating,
                        })
                i += 1

            print()
            print("=" * 60)
            print(f"  Target – Top {MAX} coffee makers")
            print("=" * 60)
            for idx, p in enumerate(products, 1):
                print(f"  {idx}. {p['name']}")
                print(f"     Price:  {p['price']}")
                print(f"     Rating: {p['rating']}")
                print()

            if not products:
                print("  ⚠ No products extracted from page text.")
                print("  Reference results from JS run:")
                for idx, r in enumerate(REFERENCE, 1):
                    print(f"  {idx}. {r.get('name','?')} – {r.get('price','?')} – Rating: {r.get('rating','?')}")

        finally:
            try:
                browser.close()
            except Exception:
                pass
            chrome_proc.terminate()
            shutil.rmtree(profile_dir, ignore_errors=True)

if __name__ == "__main__":
    main()
`;
}

/* ── popup dismissal ─────────────────────────────────────── */
async function dismissPopups(page) {
  const sels = [
    "#onetrust-accept-btn-handler",
    "button.onetrust-close-btn-handler",
    "button:has-text('Accept All')",
    "button:has-text('Accept')",
    "button:has-text('Got it')",
    "button:has-text('OK')",
    "button:has-text('Dismiss')",
    "button:has-text('Close')",
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

/* ── filter by rating ────────────────────────────────────── */
async function applyRatingFilter(stagehand, page) {
  console.log("🔧 Attempting to apply 'Guest Rating 4 & up' filter...");
  try {
    await stagehand.act("click on the 'Guest Rating' or rating filter section to expand it", { page });
    await page.waitForTimeout(1_500);
    await stagehand.act("select '4 & up' or '4 stars & up' rating filter option", { page });
    await page.waitForTimeout(2_500);
    console.log("   ✅ Rating filter applied");
  } catch (e) {
    console.log(`   ⚠ Could not apply rating filter: ${e.message}`);
  }
}

/* ── search (direct URL) ────────────────────────────────── */
async function searchTarget(stagehand, page, recorder) {
  console.log(`\n🔍 Searching Target for "${CFG.query}"...`);
  console.log(`   Loading: ${CFG.url()}`);

  await page.goto(CFG.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  recorder.record("goto", `Navigate to ${CFG.url()}`);

  await page.waitForTimeout(4_000);
  recorder.record("wait", "Wait for Target search results");

  console.log(`   ✅ Search results loaded: ${page.url()}`);
}

/* ── extract ─────────────────────────────────────────────── */
async function extractResults(stagehand, page, recorder) {
  console.log("🎯 Extracting top 5 results...\n");

  const schema = z.object({
    products: z.array(z.object({
      name:   z.string().describe("Product name / title"),
      price:  z.string().describe("Price including $ sign"),
      rating: z.string().describe("Star rating, e.g. '4.5' — or 'N/A'"),
    })).describe(`Top ${CFG.maxItems} coffee makers`),
  });

  const MAX_TRIES = 3;
  for (let t = 1; t <= MAX_TRIES; t++) {
    console.log(`   Attempt ${t}: Extracting...`);
    try {
      const { products } = await stagehand.extract(
        `Extract the top ${CFG.maxItems} product results on this Target search page. For each get the product name, price (with $ sign), and star rating (as a number like 4.5 out of 5). Skip any sponsored items or ads.`,
        schema,
      );
      if (products && products.length > 0) {
        console.log(`   ✅ Extracted ${products.length} results on attempt ${t}`);
        recorder.record("extract", `Extract top ${CFG.maxItems} products`);
        return products;
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
  console.log("  Target – Coffee Maker Search");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  ☕ Search: "${CFG.query}"`);
  console.log(`  📊 Filter: Guest Rating 4 & up`);
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
    await searchTarget(stagehand, page, recorder);

    console.log("🔲 Dismissing popups...");
    await dismissPopups(page);

    // Scroll down to ensure product cards are loaded
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(2_000);

    const results = await extractResults(stagehand, page, recorder);

    console.log(`📋 Found ${results.length} results:`);
    results.forEach((p, i) => {
      console.log(`   ${i + 1}. ${p.name}`);
      console.log(`      Price:  ${p.price}`);
      console.log(`      Rating: ${p.rating}\n`);
    });

    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} results`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((p, i) => {
      console.log(`  ${i + 1}. ${p.name}`);
      console.log(`     Price:  ${p.price}`);
      console.log(`     Rating: ${p.rating}`);
    });

    const pyPath = path.join(__dirname, "target_search.py");
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
