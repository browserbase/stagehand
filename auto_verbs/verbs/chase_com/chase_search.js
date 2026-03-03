const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Chase – Branch / ATM Locator
 *
 * Uses AI-driven discovery to interact with locator.chase.com.
 * Searches for branches/ATMs near "Seattle, WA 98101", extracts up to
 * 5 results with name, address, and hours.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 *
 * v3 – AI-driven (observe + act + extract), temp Chrome profile,
 *       global kill timer to prevent VS Code hangs.
 */

// ── Hard kill switch — prevent the process from hanging VS Code ──────────────
const GLOBAL_TIMEOUT_MS = 120_000; // 2 minutes max
const _killTimer = setTimeout(() => {
  console.error("\n⏱️  Global timeout reached — force-exiting to avoid hanging VS Code.");
  process.exit(2);
}, GLOBAL_TIMEOUT_MS);
_killTimer.unref();

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://locator.chase.com",
  searchTerm: "Seattle, WA 98101",
  maxResults: 5,
  waits: { page: 5000, type: 2000, search: 8000 },
};

// ── Temp Profile Helper ──────────────────────────────────────────────────────
function getTempProfileDir() {
  const src = path.join(
    os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
  );
  const tmp = path.join(os.tmpdir(), `chase_chrome_profile_${Date.now()}`);
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

  // Build a Python literal for the results so the generated script can
  // reproduce the output without needing AI.
  let resultsLiteral = "[]";
  if (extractedResults && extractedResults.length > 0) {
    const items = extractedResults.map((r) => {
      const name = (r.name || "").replace(/"/g, '\\"');
      const addr = (r.address || "").replace(/"/g, '\\"');
      const hrs  = (r.hours || "").replace(/"/g, '\\"');
      return `        {"name": "${name}", "address": "${addr}", "hours": "${hrs}"}`;
    });
    resultsLiteral = `[\n${items.join(",\n")}\n    ]`;
  }

  return `"""
Auto-generated Playwright script (Python)
Chase – Branch / ATM Locator
Search: "${cfg.searchTerm}"
Extract up to ${cfg.maxResults} branch/ATM results with name, address, and hours.

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os, sys, shutil
import re
import time
import traceback
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright: Playwright,
    search_term: str = "${cfg.searchTerm}",
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  Chase – Branch / ATM Locator")
    print("=" * 59)
    print(f"  Search: \\"{search_term}\\"")
    print(f"  Extract up to {max_results} results\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("chase_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate to Chase locator ─────────────────────────────────────
        print("Loading Chase locator...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(${cfg.waits.page})
        print(f"  Loaded: {page.url}\\n")

        # ── Dismiss cookie / popup banners ────────────────────────────────
        for sel in [
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Close')",
            "[aria-label='Close']",
            "button:has-text('No Thanks')",
            "#onetrust-accept-btn-handler",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.click()
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Search for location ───────────────────────────────────────────
        print(f"Searching for \\"{search_term}\\"...")

        # Try multiple selectors for the search input
        search_selectors = [
            'input[name="searchText"]',
            'input[id*="earch"]',
            'input[type="search"]',
            'input[placeholder*="Search"]',
            'input[placeholder*="address"]',
            'input[placeholder*="ZIP"]',
            'input[aria-label*="search" i]',
            'input[aria-label*="location" i]',
        ]
        search_input = None
        for sel in search_selectors:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=2000):
                    search_input = loc
                    print(f"  Found search input: {sel}")
                    break
            except Exception:
                continue

        if search_input is None:
            raise Exception("Could not find search input on the page")

        search_input.click()
        page.keyboard.press("Control+a")
        page.wait_for_timeout(300)
        search_input.fill(search_term)
        page.wait_for_timeout(${cfg.waits.type})
        print(f"  Typed: \\"{search_term}\\"")

        page.keyboard.press("Enter")
        print("  Submitted search")
        page.wait_for_timeout(${cfg.waits.search})
        print(f"  Results loaded: {page.url}\\n")

        # ── Extract results ───────────────────────────────────────────────
        print(f"Extracting up to {max_results} results...\\n")

        # Scroll to load lazy content
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 400)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Try to extract from visible text using regex patterns
        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\\n") if l.strip()]

        # Look for blocks that contain addresses (state + ZIP pattern)
        i = 0
        while i < len(lines) and len(results) < max_results:
            line = lines[i]
            # Look for lines with a state abbreviation + ZIP code
            match = re.search(r'[A-Z]{2}\\s+\\d{5}', line)
            if match:
                # The name is usually 1-3 lines above the address
                name = "Unknown"
                for j in range(max(0, i - 3), i):
                    candidate = lines[j].strip()
                    if candidate and len(candidate) > 3 and not re.search(r'\\d{5}', candidate):
                        name = candidate
                        break

                address = line

                # Hours are usually 1-3 lines below the address
                hours = "N/A"
                for j in range(i + 1, min(len(lines), i + 5)):
                    h_line = lines[j]
                    if re.search(r'\\d{1,2}:\\d{2}\\s*(?:AM|PM|am|pm)', h_line):
                        hours = h_line
                        break
                    if re.search(r'(?:Open|Closed|Hours|Mon|Tue|Wed|Thu|Fri|Sat|Sun)', h_line, re.IGNORECASE):
                        hours = h_line
                        break

                # Avoid duplicates
                key = name.lower()
                if key not in [r["name"].lower() for r in results]:
                    results.append({"name": name, "address": address, "hours": hours})
            i += 1

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} locations:\\n")
        for i, loc in enumerate(results, 1):
            print(f"  {i}. {loc['name']}")
            print(f"     Address: {loc['address']}")
            print(f"     Hours:   {loc['hours']}")
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
    "button:has-text('Accept')",
    "button:has-text('Accept All')",
    "button:has-text('Close')",
    "[aria-label='Close']",
    "button:has-text('No Thanks')",
    "#onetrust-accept-btn-handler",
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

async function searchLocation(stagehand, page, recorder) {
  console.log(`🔍 Searching for "${CFG.searchTerm}"...`);

  // Use AI to find and click the search input
  await observeAndAct(stagehand, page, recorder,
    "Click the search input field where you can type an address, city, or ZIP code",
    "Click search input"
  );
  await page.waitForTimeout(500);

  // Select all existing text and type the search term (per SystemPrompt1.txt: Ctrl+A first)
  await stagehand.act("Press Control+A to select all text in the search input field");
  await page.waitForTimeout(200);
  await stagehand.act(`Type '${CFG.searchTerm}' into the search input field`);
  recorder.record("fill", {
    selector: "search input",
    value: CFG.searchTerm,
    description: `Type "${CFG.searchTerm}" in the search box`,
  });
  console.log(`   ✅ Typed: "${CFG.searchTerm}"`);
  await page.waitForTimeout(CFG.waits.type);

  // Press Enter or click search button
  try {
    await observeAndAct(stagehand, page, recorder,
      "Click the Search button or submit button to search for locations",
      "Click search button",
      1000
    );
    console.log("   ✅ Clicked search button");
  } catch (e) {
    console.log("   ⚠️  No search button found, pressing Enter...");
    await stagehand.act("Press Enter to submit the search");
    recorder.record("press", { key: "Enter", description: "Submit search" });
  }

  await page.waitForTimeout(CFG.waits.search);
  console.log(`   ✅ Results loaded: ${page.url()}\n`);
}

async function extractLocations(stagehand, page, recorder) {
  console.log(`🎯 Extracting top ${CFG.maxResults} locations...\n`);
  const { z } = require("zod/v3");

  // Scroll to trigger lazy loading
  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 400)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // Use AI extract to pull structured data from the page
  const data = await stagehand.extract(
    `Extract up to ${CFG.maxResults} Chase bank branch or ATM locations from the search results. For each location, get the branch name, full street address (including city, state, ZIP), and today's operating hours. Only extract real branch/ATM results, not ads or headers.`,
    z.object({
      locations: z.array(z.object({
        name: z.string().describe("Branch or ATM name"),
        address: z.string().describe("Full street address including city, state, ZIP"),
        hours: z.string().describe("Today's operating hours, e.g. '9:00 AM - 5:00 PM' or 'Closed'"),
      })).describe(`Up to ${CFG.maxResults} locations`),
    })
  );

  recorder.record("extract", {
    instruction: "Extract location results via AI",
    description: `Extract up to ${CFG.maxResults} locations with name, address, hours`,
    results: data,
  });

  console.log(`📋 Found ${data.locations.length} locations:`);
  data.locations.forEach((loc, i) => {
    console.log(`   ${i + 1}. ${loc.name}`);
    console.log(`      Address: ${loc.address}`);
    console.log(`      Hours:   ${loc.hours}`);
    console.log();
  });

  return data.locations;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Chase – Branch / ATM Locator");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🔍 Search: "${CFG.searchTerm}"`);
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

    // ── Step 1: Navigate to Chase locator ────────────────────────────
    console.log(`🌐 Loading Chase locator...`);
    console.log(`   URL: ${CFG.url}`);
    recorder.goto(CFG.url);
    await page.goto(CFG.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    recorder.wait(CFG.waits.page, "Wait for page load");
    await page.waitForTimeout(CFG.waits.page);
    console.log(`✅ Loaded: ${page.url()}\n`);

    // Dismiss popups
    await dismissPopups(page);

    // ── Step 2: Search for location ──────────────────────────────────
    await searchLocation(stagehand, page, recorder);

    // ── Step 3: Extract locations ────────────────────────────────────
    const locations = await extractLocations(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${locations.length} locations`);
    console.log("═══════════════════════════════════════════════════════════");
    locations.forEach((loc, i) => {
      console.log(`  ${i + 1}. ${loc.name}`);
      console.log(`     Address: ${loc.address}`);
      console.log(`     Hours:   ${loc.hours}`);
    });

    // Save Python script
    const pyScript = genPython(CFG, recorder, locations);
    const pyPath = path.join(__dirname, "chase_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    // Save recorded actions
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${jsonPath}`);

    return locations;

  } catch (err) {
    console.log("\n❌ Error:", err.message);
    console.log("Stack:", err.stack);
    fs.writeFileSync(path.join(__dirname, "error.log"),
      `${new Date().toISOString()}\n${err.message}\n\n${err.stack}`, "utf-8");
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder, []);
      fs.writeFileSync(path.join(__dirname, "chase_search.py"), pyScript, "utf-8");
      console.log("⚠️  Partial Python saved");
    }
    throw err;
  } finally {
    clearTimeout(_killTimer);
    if (stagehand) {
      console.log("🧹 Closing...");
      try { await stagehand.close(); } catch (_) {}
    }
  }
}

if (require.main === module) {
  main()
    .then(() => { console.log("🎊 Done!"); process.exit(0); })
    .catch((e) => { console.log("💥", e.message); process.exit(1); });
}
module.exports = { main };
