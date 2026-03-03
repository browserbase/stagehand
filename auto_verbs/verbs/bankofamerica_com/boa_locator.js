const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Bank of America – Branch & ATM Locator
 *
 * Uses AI-driven discovery to interact with the BoA branch/ATM locator.
 * Searches for branches and ATMs near a given location, extracts up to 5
 * results with name/type, address, and distance.
 *
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.bankofamerica.com/locator/",
  location: "Redmond, WA 98052",
  maxResults: 5,
  waits: { page: 5000, type: 2000, select: 2000, search: 5000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Bank of America – Branch & ATM Locator
Location: ${cfg.location}
Max results: ${cfg.maxResults}

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import re
import os, sys, shutil
import traceback
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright: Playwright,
    location: str = "${cfg.location}",
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  Bank of America – Branch & ATM Locator")
    print("=" * 59)
    print(f"  Location: {location}")
    print(f"  Max results: {max_results}\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("bankofamerica_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate ──────────────────────────────────────────────────────
        print("Loading Bank of America Locator...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups / cookie banners ───────────────────────────────
        for selector in [
            "button#onetrust-accept-btn-handler",
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Got it')",
            "button:has-text('Close')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── STEP 1: Enter location in search box ─────────────────────────
        print(f"STEP 1: Search for '{location}'...")
        # Concrete selectors from recorded JS run
        search_input = page.locator(
            "#q, "
            "input[name='locator-search-value'], "
            "input[aria-label='Enter address, ZIP code or landmark'], "
            "#map-search-form input[type='text']"
        ).first
        try:
            search_input.wait_for(state="visible", timeout=10000)
        except Exception:
            # Fallback: find any visible text input inside the search form
            search_input = page.locator("form input[type='text']:visible").first
            search_input.wait_for(state="visible", timeout=5000)
        search_input.evaluate("el => el.click()")
        page.keyboard.press("Control+a")
        page.keyboard.press("Backspace")
        search_input.type(location, delay=50)
        print(f"  Typed '{location}'")
        page.wait_for_timeout(1000)

        # ── STEP 2: Submit search ─────────────────────────────────────────
        print("STEP 2: Submit search...")
        # Try clicking a search/submit button (concrete selectors from recorded JS run)
        submitted = False
        for sel in [
            "#search-button",
            "button[aria-label='Click to submit search form']",
            "#map-search-form button[type='submit']",
            "button[type='submit']",
            "button:has-text('Search')",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=2000):
                    btn.evaluate("el => el.click()")
                    submitted = True
                    print("  Clicked Search button")
                    break
            except Exception:
                pass
        if not submitted:
            page.keyboard.press("Enter")
            print("  Pressed Enter")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  URL: {page.url}")

        # ── STEP 3: Extract results ───────────────────────────────────────
        print(f"STEP 3: Extract up to {max_results} results...")

        # Wait for result cards to load
        page.wait_for_timeout(3000)

        # Concrete selectors discovered from the live page DOM:
        #   Card:     li.map-list-item-wrap.is-visible
        #   Name:     button.location-name  (short name like "Redmond")
        #   Type:     div.location-type     (e.g. "Financial Center & ATM")
        #   Distance: div.distance:not(.feet) span  (e.g. "0.3 mi")
        #   Address:  first line of div.map-list-item-inner innerText
        cards = page.locator("li.map-list-item-wrap.is-visible")
        count = cards.count()
        print(f"  Found {count} result cards")

        seen_names = set()
        for i in range(count):
            if len(results) >= max_results:
                break
            card = cards.nth(i)
            try:
                # Name + type
                name = "N/A"
                loc_type = ""
                try:
                    name = card.locator("button.location-name").first.inner_text(timeout=2000).strip()
                except Exception:
                    pass
                try:
                    loc_type = card.locator("div.location-type").first.inner_text(timeout=2000).strip()
                except Exception:
                    pass
                if name != "N/A" and loc_type:
                    name = f"{name} {loc_type}"

                # Address (first line of .map-list-item-inner)
                address = "N/A"
                try:
                    inner_text = card.locator("div.map-list-item-inner").first.inner_text(timeout=2000).strip()
                    if inner_text:
                        address = inner_text.split("\\n")[0].strip()
                except Exception:
                    pass

                # Distance
                distance = "N/A"
                try:
                    dist_el = card.locator("div.distance:not(.feet) span").first
                    distance = dist_el.inner_text(timeout=2000).strip()
                except Exception:
                    card_text = card.inner_text(timeout=2000)
                    dist_match = re.search(r"([\\d.]+)\\s*mi", card_text, re.IGNORECASE)
                    if dist_match:
                        distance = dist_match.group(0)

                if name == "N/A":
                    continue
                name_key = name.lower().strip()
                if name_key in seen_names:
                    continue
                seen_names.add(name_key)

                results.append({
                    "name": name,
                    "address": address,
                    "distance": distance,
                })
            except Exception:
                continue

        # Fallback: regex-based extraction from full page text
        if not results:
            print("  Card extraction failed, trying text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            lines = [l.strip() for l in body_text.split("\\n") if l.strip()]
            for i, line in enumerate(lines):
                if len(results) >= max_results:
                    break
                dm = re.search(r"([\\d.]+)\\s*mi", line, re.IGNORECASE)
                if dm and len(line) < 20:
                    name = "N/A"
                    address = "N/A"
                    for j in range(i - 1, max(0, i - 6), -1):
                        candidate = lines[j]
                        if re.match(r"\\d+\\s+\\w", candidate) and address == "N/A":
                            address = candidate
                        elif len(candidate) > 3 and name == "N/A" and candidate not in ("Make my favorite",):
                            name = candidate
                    results.append({
                        "name": name,
                        "address": address,
                        "distance": dm.group(0),
                    })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} locations near '{location}':\\n")
        for i, loc in enumerate(results, 1):
            print(f"  {i}. {loc['name']}")
            print(f"     Address:  {loc['address']}")
            print(f"     Distance: {loc['distance']}")

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
        print(f"\\nTotal locations: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  for (let i = 0; i < 3; i++) {
    const clicked = await page.evaluate(`(() => {
      const btns = document.querySelectorAll('button, a, [role="button"]');
      for (const btn of btns) {
        const txt = (btn.textContent || btn.getAttribute('aria-label') || '').trim().toLowerCase();
        if (['close','dismiss','accept','got it','ok','no thanks','not now',
             'accept all cookies','accept all','accept cookies'].includes(txt)) {
          if (btn.offsetParent !== null || btn.getClientRects().length > 0) {
            btn.click(); return txt;
          }
        }
      }
      const ot = document.querySelector('#onetrust-accept-btn-handler');
      if (ot && (ot.offsetParent !== null || ot.getClientRects().length > 0)) {
        ot.click(); return 'onetrust';
      }
      return false;
    })()`);
    if (clicked) {
      console.log(`   ✅ Dismissed: "${clicked}"`);
      await page.waitForTimeout(800);
    } else break;
  }
  await page.waitForTimeout(500);
}

async function searchLocation(stagehand, page, recorder, location) {
  console.log(`🎯 STEP 1: Search for "${location}"...`);

  // Use observe+act to find and click the search input
  await observeAndAct(stagehand, page, recorder,
    "Click the search input field where I can type a location, address, city, or zip code to search for nearby branches and ATMs",
    "Click search input"
  );
  await page.waitForTimeout(500);

  // Clear existing text and type the location
  await page.keyPress("Control+a");
  await page.waitForTimeout(100);
  await page.type(location, { delay: 60 });
  console.log(`   ✅ Typed "${location}"`);
  recorder.record("act", {
    instruction: `Type "${location}" into search`,
    description: `Fill search: ${location}`,
    method: "type",
  });
  await page.waitForTimeout(CFG.waits.type);
}

async function submitSearch(stagehand, page, recorder) {
  console.log("🎯 STEP 2: Submit search...");

  // Try to click a search/submit button
  try {
    await observeAndAct(stagehand, page, recorder,
      "Click the Search button or submit button to search for nearby branches and ATMs",
      "Click Search button"
    );
    console.log("   ✅ Clicked Search button");
  } catch (e) {
    // Fallback: press Enter
    console.log("   No search button found, pressing Enter...");
    await page.keyPress("Enter");
    recorder.record("act", {
      instruction: "Press Enter to search",
      description: "Submit search",
      method: "keyPress",
    });
  }

  // Wait for results
  await page.waitForTimeout(CFG.waits.search);
  try {
    await page.waitForLoadState("domcontentloaded");
  } catch (_) { /* */ }
  await page.waitForTimeout(3000);
  const url = await page.evaluate("window.location.href");
  console.log(`   📍 URL: ${url}`);
}

async function extractResults(stagehand, page, recorder) {
  console.log(`🎯 STEP 3: Extract up to ${CFG.maxResults} results...\n`);
  const { z } = require("zod/v3");

  // Scroll to load results
  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 300)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // AI extraction with zod schema
  let results;
  try {
    results = await stagehand.extract(
      `Extract up to ${CFG.maxResults} Bank of America branch or ATM locations from the search results. For each location, get: 1) the name and type (e.g. "Financial Center & ATM" or "ATM"), 2) the full street address including city, state, and zip code, and 3) the distance (e.g. "0.3 mi"). Only extract real location results, not ads or headers.`,
      z.object({
        locations: z.array(z.object({
          name: z.string().describe("Location name and type, e.g. 'Redmond Financial Center & ATM'"),
          address: z.string().describe("Full street address with city, state, zip"),
          distance: z.string().describe("Distance from search location, e.g. '0.3 mi'"),
        })).describe(`Up to ${CFG.maxResults} branch/ATM locations`),
      })
    );
  } catch (e) {
    console.log("   ⚠️ AI extraction failed:", e.message);
    results = { locations: [] };
  }

  recorder.record("extract", {
    instruction: "Extract branch/ATM locations",
    description: `Extract up to ${CFG.maxResults} locations`,
    results,
  });

  // Fallback: text-based extraction if AI returned nothing
  if (results.locations.length === 0) {
    console.log("   Trying text-based extraction...");
    const bodyText = await page.evaluate("document.body.innerText");
    const lines = bodyText.split("\n");
    for (let i = 0; i < lines.length && results.locations.length < CFG.maxResults; i++) {
      const line = lines[i].trim();
      const distMatch = line.match(/([\d.]+)\s*(?:mi|mile|miles)/i);
      if (distMatch && line.length < 200) {
        let name = "N/A", address = "N/A";
        for (let j = Math.max(0, i - 5); j < i; j++) {
          const candidate = lines[j].trim();
          if (candidate && candidate.length > 3) {
            if (name === "N/A") name = candidate;
            else if (address === "N/A") address = candidate;
          }
        }
        results.locations.push({
          name,
          address,
          distance: distMatch[0],
        });
      }
    }
  }

  console.log(`📋 Found ${results.locations.length} locations:`);
  results.locations.forEach((loc, i) => {
    console.log(`   ${i + 1}. ${loc.name}`);
    console.log(`      Address:  ${loc.address}`);
    console.log(`      Distance: ${loc.distance}`);
  });

  return results;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Bank of America – Branch & ATM Locator");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  📍 ${CFG.location}`);
  console.log(`  🔍 Up to ${CFG.maxResults} results\n`);

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
        userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: ["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions", "--start-maximized", "--window-size=1920,1080"],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");

    const page = stagehand.context.pages()[0];

    // Navigate to the locator page
    console.log(`🌐 Loading ${CFG.url}...`);
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Loaded\n");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);

    await dismissPopups(page);
    await searchLocation(stagehand, page, recorder, CFG.location);
    await submitSearch(stagehand, page, recorder);

    const results = await extractResults(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.locations.length} locations found`);
    console.log("═══════════════════════════════════════════════════════════");
    results.locations.forEach((loc, i) => {
      console.log(`  ${i + 1}. ${loc.name}`);
      console.log(`     ${loc.address}`);
      console.log(`     Distance: ${loc.distance}`);
    });

    // Save Python + JSON
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "boa_locator.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python: ${pyPath}`);

    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions: ${jsonPath}`);

    return results;

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder);
      fs.writeFileSync(path.join(__dirname, "boa_locator.py"), pyScript, "utf-8");
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
    .catch((e) => { console.error("💥", e.message); process.exit(1); });
}
module.exports = { main };
