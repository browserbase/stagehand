const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * CVS – Store Locator
 *
 * Uses AI-driven discovery to find CVS Pharmacy locations near zip code "10001"
 * (Manhattan, NY), then extracts the top 5 closest stores with address, phone,
 * hours, and whether they have a pharmacy and MinuteClinic.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Hard kill switch — prevent the process from hanging VS Code ──────────────
const GLOBAL_TIMEOUT_MS = 150_000; // 2.5 minutes max
const _killTimer = setTimeout(() => {
  console.error("\n⏱️  Global timeout reached — force-exiting to avoid hanging VS Code.");
  process.exit(2);
}, GLOBAL_TIMEOUT_MS);
_killTimer.unref();

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.cvs.com/store-locator/landing",
  zipCode: "10001",
  maxResults: 5,
  waits: { page: 5000, type: 1500, search: 8000, popup: 2000 },
};

// ── Temp Profile Helper ──────────────────────────────────────────────────────
function getTempProfileDir() {
  const src = path.join(
    os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
  );
  const tmp = path.join(os.tmpdir(), `cvs_chrome_profile_${Date.now()}`);
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
CVS – Store Locator
Zip Code: "${cfg.zipCode}"
Extract up to ${cfg.maxResults} stores with address, phone, hours, pharmacy, MinuteClinic.

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
    zip_code: str = "${cfg.zipCode}",
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  CVS – Store Locator")
    print("=" * 59)
    print(f"  Zip Code: \\"{zip_code}\\"")
    print(f"  Extract up to {max_results} stores\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("cvs_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate to store locator landing page ──────────────────
        landing_url = "https://www.cvs.com/store-locator/landing"
        print(f"Loading: {landing_url}")
        page.goto(landing_url, timeout=45000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\\n")

        # ── Dismiss cookie / popup banners ────────────────────────────
        for sel in [
            "#onetrust-accept-btn-handler",
            "button.onetrust-close-btn-handler",
            "button:has-text('Accept All')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Search by zip code ────────────────────────────────────────
        print(f"Searching for stores near {zip_code}...")
        search_input = page.locator("cvs-combobox input, input[aria-label*='Search']").first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        search_input.press("Control+a")
        search_input.fill(zip_code)
        page.wait_for_timeout(1000)
        search_input.press("Enter")
        page.wait_for_timeout(8000)
        print(f"  Results loaded: {page.url}\\n")

        # ── Scroll to load content ────────────────────────────────────
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # ── Extract results ───────────────────────────────────────────
        print(f"Extracting up to {max_results} stores...\\n")

        # CVS uses web components (shadow DOM) for store cards, so
        # document.body.innerText doesn't include store data.
        # Use a JS script that traverses shadow roots to extract text,
        # skipping <style> and <script> elements.
        body_text = page.evaluate("""() => {
            function getDeepText(node) {
                let text = '';
                if (node.shadowRoot) {
                    text += getDeepText(node.shadowRoot);
                }
                for (const child of node.childNodes) {
                    if (child.nodeType === Node.TEXT_NODE) {
                        const t = child.textContent.trim();
                        if (t) text += t + '\\\\n';
                    } else if (child.nodeType === Node.ELEMENT_NODE) {
                        const tag = child.tagName.toLowerCase();
                        if (tag !== 'style' && tag !== 'script' && tag !== 'noscript') {
                            text += getDeepText(child);
                        }
                    }
                }
                return text;
            }
            return getDeepText(document.body);
        }""") or ""
        lines = [l.strip() for l in body_text.split("\\n") if l.strip()]

        # ── Extract results using CVS page structure ────────────────
        # CVS store listings follow a consistent pattern:
        #   [number] -> address -> CITY, ST, ZIP -> ... phone -> hours -> services
        # Find store blocks by looking for lines that are just a single number (1-9)
        store_starts = []
        for k, ln in enumerate(lines):
            if re.match(r'^\\d$', ln) and k > 0:
                # Verify it's preceded by "X.X miles" (distance indicator)
                prev = lines[k - 1] if k > 0 else ""
                if "mile" in prev.lower():
                    store_starts.append(k)

        for si, start_idx in enumerate(store_starts):
            if len(results) >= max_results:
                break
            # Determine end of this store block
            end_idx = store_starts[si + 1] - 2 if si + 1 < len(store_starts) else min(start_idx + 25, len(lines))

            block = lines[start_idx + 1 : end_idx]  # skip the number line
            store = {
                "address": "N/A",
                "phone": "N/A",
                "hours": "N/A",
                "has_pharmacy": "Unknown",
                "has_minuteclinic": "Unknown",
            }

            # First line is always the street address
            if block:
                store["address"] = block[0]

            for j, bl in enumerate(block):
                cl = bl.lower()

                # City, State, Zip
                if re.match(r'^[A-Z].*,\\s*[A-Z]{2}\\s*,?\\s*\\d{5}', bl):
                    store["address"] = f"{store['address']}, {bl}"

                # Phone number
                elif re.search(r'\\(\\d{3}\\)\\s*\\d{3}[\\s.-]?\\d{4}', bl):
                    m = re.search(r'\\(\\d{3}\\)\\s*\\d{3}[\\s.-]?\\d{4}', bl)
                    if m:
                        store["phone"] = m.group(0)

                # Store hours — look for "Open 24 hours" or combine Open/Closed lines
                elif cl in ("open", "closed") and store["hours"] == "N/A":
                    # Peek at next line for details
                    nxt = block[j + 1].strip() if j + 1 < len(block) else ""
                    if nxt.startswith(","):
                        store["hours"] = f"{bl}{nxt}"
                    elif "hour" in nxt.lower() or re.search(r'\\d', nxt):
                        store["hours"] = f"{bl} {nxt}"
                    else:
                        store["hours"] = bl

                # Pharmacy
                elif cl == "pharmacy:" or cl.startswith("pharmacy"):
                    store["has_pharmacy"] = "Yes"

                # MinuteClinic
                elif "minuteclinic" in cl:
                    store["has_minuteclinic"] = "Yes"

            if store["address"] != "N/A":
                results.append(store)

        # ── Print results ─────────────────────────────────────────────
        print(f"\\nFound {len(results)} stores:\\n")
        for i, s in enumerate(results, 1):
            print(f"  {i}. {s['address']}")
            print(f"     Phone:        {s['phone']}")
            print(f"     Hours:        {s['hours']}")
            print(f"     Pharmacy:     {s['has_pharmacy']}")
            print(f"     MinuteClinic: {s['has_minuteclinic']}")
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
  // Be careful with generic selectors like [aria-label='Close'] — on CVS
  // it can close the store locator panel itself, not just popups.
  const selectors = [
    "#onetrust-accept-btn-handler",
    "button.onetrust-close-btn-handler",
    "button:has-text('Accept All')",
    "button:has-text('Accept')",
    "button:has-text('Got it')",
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

async function searchByZipCode(stagehand, page, recorder) {
  console.log(`🔍 Searching for CVS stores near "${CFG.zipCode}"...`);

  // Navigate to the store locator page
  console.log(`   Loading: ${CFG.url}`);
  recorder.goto(CFG.url);
  await page.goto(CFG.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  recorder.wait(CFG.waits.page, "Wait for store locator page");
  await page.waitForTimeout(CFG.waits.page);
  console.log(`   \u2705 Store locator loaded: ${page.url()}`);

  // Dismiss popups before interacting
  await dismissPopups(page);

  // Use AI to find the location/zip code search input on the store locator page
  // This is distinct from the product search in the header.
  let navigated = false;
  try {
    await observeAndAct(stagehand, page, recorder,
      "Click the location search input field on the store locator page where you can enter a zip code, city, or address to find nearby CVS stores. This is NOT the product search box in the header — it is the main search field in the body of the store locator page.",
      "Click store locator search input"
    );
    await page.waitForTimeout(500);

    // Ctrl+A then type zip code
    await stagehand.act("Press Control+A to select all text in the location search input");
    await page.waitForTimeout(200);
    await stagehand.act(`Type '${CFG.zipCode}' into the location search input field`);
    recorder.record("fill", {
      selector: "store locator search input",
      value: CFG.zipCode,
      description: `Type "${CFG.zipCode}" in the store locator search box`,
    });
    console.log(`   \u2705 Typed: "${CFG.zipCode}"`);
    await page.waitForTimeout(CFG.waits.type);

    // Submit the search
    await stagehand.act("Click the search button next to the location input to find stores, or press Enter to submit");
    recorder.record("press", { key: "Enter", description: "Submit store search" });
    console.log("   \u2705 Submitted search");

    await page.waitForTimeout(CFG.waits.search);

    // Check if we have store results
    const bodyText = await page.evaluate("document.body.innerText");
    if (bodyText.toLowerCase().includes("mile") || bodyText.toLowerCase().includes("open") || bodyText.toLowerCase().includes("store")) {
      navigated = true;
      console.log(`   \u2705 Store results loaded: ${page.url()}\n`);
    }
  } catch (e) {
    console.log(`   \u26A0\uFE0F  UI search failed: ${e.message}`);
  }

  // Fallback: go directly to store locator search results URL
  if (!navigated) {
    const fallbackUrl = `https://www.cvs.com/store-locator/cvs-pharmacy-locations/${CFG.zipCode}`;
    console.log(`   \uD83D\uDD04 Fallback: ${fallbackUrl}`);
    recorder.goto(fallbackUrl);
    await page.goto(fallbackUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(CFG.waits.search);
    console.log(`   \u2705 Store results loaded via fallback URL: ${page.url()}\n`);
  }
}

async function extractStores(stagehand, page, recorder) {
  console.log(`🎯 Extracting top ${CFG.maxResults} stores...\n`);
  const { z } = require("zod/v3");

  const schema = z.object({
    stores: z.array(z.object({
      address: z.string().describe("Full store address including street, city, state, zip"),
      phone: z.string().describe("Phone number of the store"),
      hours: z.string().describe("Store hours or operating schedule, e.g. 'Open 24 Hours' or 'Mon-Fri 8AM-10PM'"),
      hasPharmacy: z.string().describe("Whether the store has a pharmacy — 'Yes' or 'No'"),
      hasMinuteClinic: z.string().describe("Whether the store has a MinuteClinic — 'Yes' or 'No'"),
    })).describe(`Top ${CFG.maxResults} closest CVS store locations`),
  });

  const instruction = `Extract the first ${CFG.maxResults} CVS Pharmacy store locations listed on this store locator page for zip code ${CFG.zipCode}. Each store listing card should have: (1) full street address with city, state, zip, (2) phone number, (3) store hours like "Open 24 Hours" or "Open until 10PM" or specific hours, (4) whether it has a Pharmacy (look for "Pharmacy" label/link — Yes or No), (5) whether it has a MinuteClinic (look for "MinuteClinic" label/link — Yes or No). Return exactly ${CFG.maxResults} stores.`;

  // Scroll to load all store cards
  console.log("   Scrolling to load store listings...");
  for (let i = 0; i < 6; i++) {
    await page.evaluate("window.scrollBy(0, 600)");
    await page.waitForTimeout(500);
  }
  // Scroll back to top where store listings begin
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(3000);

  // Try extraction up to 3 times
  let data = { stores: [] };
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Attempt ${attempt}: Extracting...`);

    try {
      data = await stagehand.extract(instruction, schema);
      if (data.stores.length > 0) {
        // Verify we got meaningful data (address + at least phone or hours)
        const hasDetail = data.stores.some(s =>
          s.address && s.address.length > 10 &&
          (s.phone !== "N/A" || s.hours !== "N/A")
        );
        if (hasDetail) {
          console.log(`   ✅ Extracted ${data.stores.length} stores on attempt ${attempt}`);
          break;
        }
      }
      console.log(`   ⚠️  Attempt ${attempt}: ${data.stores.length} stores but missing details, scrolling...`);
      await page.evaluate("window.scrollBy(0, 600)");
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log(`   ⚠️  Attempt ${attempt} failed: ${e.message}`);
      await page.evaluate("window.scrollBy(0, 500)");
      await page.waitForTimeout(2000);
    }
  }

  recorder.record("extract", {
    instruction: "Extract store locations via AI",
    description: `Extract up to ${CFG.maxResults} stores with address, phone, hours, pharmacy, MinuteClinic`,
    results: data,
  });

  console.log(`📋 Found ${data.stores.length} stores:`);
  data.stores.forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.address}`);
    console.log(`      Phone:        ${s.phone}`);
    console.log(`      Hours:        ${s.hours}`);
    console.log(`      Pharmacy:     ${s.hasPharmacy}`);
    console.log(`      MinuteClinic: ${s.hasMinuteClinic}`);
    console.log();
  });

  return data.stores;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  CVS – Store Locator");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  📍 Zip Code: "${CFG.zipCode}"`);
  console.log(`  📦 Extract up to ${CFG.maxResults} stores\n`);

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

    // ── Step 1: Navigate to store locator and search by zip code ────
    await searchByZipCode(stagehand, page, recorder);

    // Dismiss any popups again after search
    await dismissPopups(page);

    // ── Step 2: Extract store listings ───────────────────────────────
    const stores = await extractStores(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${stores.length} stores`);
    console.log("═══════════════════════════════════════════════════════════");
    stores.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.address}`);
      console.log(`     Phone:        ${s.phone}`);
      console.log(`     Hours:        ${s.hours}`);
      console.log(`     Pharmacy:     ${s.hasPharmacy}`);
      console.log(`     MinuteClinic: ${s.hasMinuteClinic}`);
    });

    // Save Python script
    const pyScript = genPython(CFG, recorder, stores);
    const pyPath = path.join(__dirname, "cvs_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    // Save recorded actions
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${jsonPath}`);

    return stores;

  } catch (err) {
    console.log("\n❌ Error:", err.message);
    console.log("Stack:", err.stack);
    fs.writeFileSync(path.join(__dirname, "error.log"),
      `${new Date().toISOString()}\n${err.message}\n\n${err.stack}`, "utf-8");
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder, []);
      fs.writeFileSync(path.join(__dirname, "cvs_search.py"), pyScript, "utf-8");
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
