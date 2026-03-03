/**
 * Walmart – Wireless Earbuds Search
 *
 * Prompt (prompt1.txt):
 *   Search for "wireless earbuds", sort by "Best Seller",
 *   extract top 5 results (name, price, rating).
 *
 * Strategy:
 *   Direct URL: walmart.com/search?q=wireless+earbuds&sort=best_seller
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
  query:    "wireless earbuds",
  sort:     "best_seller",
  maxItems: 5,
  url() {
    return `https://www.walmart.com/search?q=${encodeURIComponent(this.query)}&sort=${this.sort}`;
  },
};

/* ── temp Chrome profile ─────────────────────────────────── */
function getTempProfileDir(site = "walmart") {
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
"""Walmart wireless earbuds search – Playwright (auto-generated)."""

import json, re, subprocess, tempfile, shutil, os, sys, time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY   = "${CFG.query}"
SORT    = "${CFG.sort}"
MAX     = ${CFG.maxItems}
URL     = f"https://www.walmart.com/search?q={QUERY.replace(' ', '+')}&sort={SORT}"

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
        profile_dir = get_temp_profile_dir("walmart_com")
        chrome_proc = launch_chrome(profile_dir, port)
        ws_url = wait_for_cdp_ws(port)
        browser = pw.chromium.connect_over_cdp(ws_url)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else context.new_page()
        try:
            page.goto(URL, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(3000)
            dismiss(page)

            # Extract from body text
            text = page.inner_text("body")
            lines = [l.strip() for l in text.splitlines() if l.strip()]

            products = []
            i = 0
            while i < len(lines) and len(products) < MAX:
                line = lines[i]
                # Walmart product cards often show price like "$XX.XX" or "Now $XX.XX"
                price_match = re.match(r'^(?:Now\\s+)?\\$(\\d+(?:\\.\\d{2})?)', line)
                if price_match and i > 0:
                    # Look backwards for product name
                    name = None
                    for back in range(i - 1, max(i - 5, -1), -1):
                        candidate = lines[back]
                        # Product names are usually longer and not prices/ratings
                        if (len(candidate) > 15
                            and not candidate.startswith('$')
                            and not re.match(r'^\\d+(\\.\\d)?\\s*out of', candidate)
                            and 'Sponsored' not in candidate
                            and not candidate.startswith('Save ')
                            and not candidate.startswith('Options ')
                            and not candidate.startswith('Best seller')):
                            name = candidate
                            break
                    if not name:
                        i += 1
                        continue

                    price_str = "$" + price_match.group(1)

                    # Look nearby for rating
                    rating = "N/A"
                    for near in range(max(i - 3, 0), min(i + 5, len(lines))):
                        rm = re.search(r'(\\d+\\.\\d)\\s*out of\\s*5', lines[near])
                        if rm:
                            rating = rm.group(1)
                            break

                    # Avoid duplicates
                    if not any(p["name"] == name for p in products):
                        products.append({
                            "name": name,
                            "price": price_str,
                            "rating": rating,
                        })
                i += 1

            print()
            print("=" * 60)
            print(f"  Walmart – Top {MAX} wireless earbuds (Best Seller)")
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
async function searchWalmart(stagehand, page, recorder) {
  console.log(`\n🔍 Searching Walmart for "${CFG.query}" (sort: ${CFG.sort})...`);
  console.log(`   Loading: ${CFG.url()}`);

  await page.goto(CFG.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
  recorder.record("goto", `Navigate to ${CFG.url()}`);

  await page.waitForTimeout(3_000);
  recorder.record("wait", "Wait for Walmart search results");

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
    })).describe(`Top ${CFG.maxItems} wireless earbuds`),
  });

  const MAX_TRIES = 3;
  for (let t = 1; t <= MAX_TRIES; t++) {
    console.log(`   Attempt ${t}: Extracting...`);
    try {
      const { products } = await stagehand.extract(
        `Extract the top ${CFG.maxItems} product results. For each get the product name, price (with $ sign), and star rating (number out of 5). Skip sponsored banners.`,
        schema,
      );
      if (products && products.length > 0) {
        console.log(`   ✅ Extracted ${products.length} results on attempt ${t}`);
        recorder.record("extract", `Extract top ${CFG.maxItems} products with name, price, rating`);
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
  console.log("  Walmart – Wireless Earbuds Search");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🎧 Search: "${CFG.query}"`);
  console.log(`  📊 Sort by: Best Seller`);
  console.log(`  📦 Extract up to ${CFG.maxItems} results\n`);

  /* LLM */
  console.log("🤖 Setting up GitHub Models API...");
  const llmClient = setupLLMClient("hybrid");
  console.log("✅ GitHub Models API ready\n");

  /* Stagehand */
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
    await searchWalmart(stagehand, page, recorder);

    console.log("🔲 Dismissing popups...");
    await dismissPopups(page);

    const results = await extractResults(stagehand, page, recorder);

    /* display */
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

    /* save python */
    const pyPath = path.join(__dirname, "walmart_search.py");
    fs.writeFileSync(pyPath, genPython(results), "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    /* save actions */
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
