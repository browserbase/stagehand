const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Wikipedia – Article Search & Extract
 *
 * Uses AI-driven discovery to search Wikipedia for "Space Needle",
 * then extracts the first paragraph of the article summary and
 * key facts from the infobox (location, height, opened date).
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
  url: "https://en.wikipedia.org",
  searchTerm: "Space Needle",
  waits: { page: 3000, type: 1000, search: 3000 },
};

// ── Temp Profile Helper ──────────────────────────────────────────────────────
function getTempProfileDir() {
  const src = path.join(
    os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
  );
  const tmp = path.join(os.tmpdir(), `wiki_chrome_profile_${Date.now()}`);
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
function genPython(cfg, recorder, extractedData) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
Wikipedia – Article Search & Extract
Search: "${cfg.searchTerm}"
Extract: first paragraph summary + infobox facts (location, height, opened date).

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os, sys, shutil
import re
import traceback
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright: Playwright,
    search_term: str = "${cfg.searchTerm}",
) -> dict:
    print("=" * 59)
    print("  Wikipedia – Article Search & Extract")
    print("=" * 59)
    print(f'  Search: "{search_term}"\\n')
    port = get_free_port()
    profile_dir = get_temp_profile_dir("wikipedia_org")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {}

    try:
        # ── Navigate to Wikipedia ─────────────────────────────────────
        print(f"Loading: ${cfg.url}")
        page.goto("${cfg.url}", timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(2000)

        # ── Search for the article ────────────────────────────────────
        print(f'Searching for "{search_term}"...')
        search_input = page.locator("#searchInput, input[name='search']").first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(300)
        search_input.press("Control+a")
        search_input.fill(search_term)
        page.wait_for_timeout(500)
        search_input.press("Enter")
        page.wait_for_timeout(3000)
        print(f"  Loaded: {page.url}\\n")

        # ── Extract first paragraph ───────────────────────────────────
        print("Extracting article summary...")
        first_para = ""
        try:
            # The first paragraph in the article body
            paragraphs = page.locator("#mw-content-text .mw-parser-output > p")
            for i in range(paragraphs.count()):
                text = paragraphs.nth(i).inner_text().strip()
                if text and len(text) > 50:
                    first_para = text
                    break
        except Exception:
            pass
        result["summary"] = first_para

        # ── Extract infobox facts ─────────────────────────────────────
        print("Extracting infobox facts...")
        infobox_data = {"location": "N/A", "height": "N/A", "opened": "N/A"}
        try:
            rows = page.locator(".infobox tr")
            for i in range(rows.count()):
                row_text = rows.nth(i).inner_text().strip().lower()
                full_text = rows.nth(i).inner_text().strip()
                if "location" in row_text:
                    parts = full_text.split("\\t")
                    if len(parts) >= 2:
                        infobox_data["location"] = parts[-1].strip()
                elif "height" in row_text and infobox_data["height"] == "N/A":
                    parts = full_text.split("\\t")
                    if len(parts) >= 2:
                        infobox_data["height"] = parts[-1].strip()
                elif "opened" in row_text or "opening" in row_text:
                    parts = full_text.split("\\t")
                    if len(parts) >= 2:
                        infobox_data["opened"] = parts[-1].strip()
        except Exception:
            pass
        result["infobox"] = infobox_data

        # ── Print results ─────────────────────────────────────────────
        print(f"\\n{'=' * 59}")
        print("  Results")
        print(f"{'=' * 59}")
        print(f"\\n  Summary (first paragraph):")
        print(f"  {result['summary'][:500]}...")
        print(f"\\n  Infobox Facts:")
        print(f"     Location: {result['infobox']['location']}")
        print(f"     Height:   {result['infobox']['height']}")
        print(f"     Opened:   {result['infobox']['opened']}")
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
    return result


if __name__ == "__main__":
    with sync_playwright() as playwright:
        data = run(playwright)
        print(f"Done — extracted {len(data)} fields")
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

async function searchArticle(stagehand, page, recorder) {
  console.log(`🔍 Searching for "${CFG.searchTerm}" on Wikipedia...`);

  console.log(`   Loading: ${CFG.url}`);
  recorder.goto(CFG.url);
  await page.goto(CFG.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  recorder.wait(CFG.waits.page, "Wait for Wikipedia");
  await page.waitForTimeout(CFG.waits.page);
  console.log(`   ✅ Wikipedia loaded: ${page.url()}`);

  await dismissPopups(page);

  // Use AI to find and interact with the search box
  await observeAndAct(stagehand, page, recorder,
    `Click the Wikipedia search input field where you can type a search query.`,
    "Click search input"
  );
  await page.waitForTimeout(300);

  await stagehand.act("Press Control+A to select all text in the search input");
  await page.waitForTimeout(200);

  await stagehand.act(`Type '${CFG.searchTerm}' into the search input field`);
  recorder.record("fill", {
    selector: "search input",
    value: CFG.searchTerm,
    description: `Type "${CFG.searchTerm}" in the search box`,
  });
  console.log(`   ✅ Typed: "${CFG.searchTerm}"`);
  await page.waitForTimeout(CFG.waits.type);

  await stagehand.act("Press Enter to submit the search");
  recorder.record("press", { key: "Enter", description: "Submit search" });
  console.log("   ✅ Submitted search");

  await page.waitForTimeout(CFG.waits.search);
  console.log(`   ✅ Article loaded: ${page.url()}\n`);
}

async function extractArticle(stagehand, page, recorder) {
  console.log("🎯 Extracting article data...\n");
  const { z } = require("zod/v3");

  const schema = z.object({
    summary: z.string().describe("The first paragraph of the article summary text (the introductory paragraph before the table of contents)"),
    location: z.string().describe("Location of the Space Needle from the infobox"),
    height: z.string().describe("Height of the Space Needle from the infobox (e.g. '605 ft')"),
    openedDate: z.string().describe("Date the Space Needle was opened from the infobox"),
  });

  const instruction = `Extract the following from this Wikipedia article about "${CFG.searchTerm}":
1. The first substantial paragraph of the article summary (the main introductory text before the table of contents).
2. From the infobox on the right side: the location, height, and opened/opening date of the Space Needle.`;

  // Scroll to ensure content is loaded
  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 400)");
    await page.waitForTimeout(300);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  let data = { summary: "", location: "N/A", height: "N/A", openedDate: "N/A" };
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Attempt ${attempt}: Extracting...`);
    try {
      data = await stagehand.extract(instruction, schema);
      if (data.summary && data.summary.length > 50) {
        console.log(`   ✅ Extracted article data on attempt ${attempt}`);
        break;
      }
      console.log(`   ⚠️  Attempt ${attempt}: incomplete data, retrying...`);
    } catch (e) {
      console.log(`   ⚠️  Attempt ${attempt} failed: ${e.message}`);
    }
  }

  recorder.record("extract", {
    instruction: "Extract article summary and infobox facts",
    description: "Extract first paragraph + infobox (location, height, opened)",
    results: data,
  });

  console.log("📋 Extracted data:");
  console.log(`   Summary: ${data.summary.substring(0, 200)}...`);
  console.log(`   Location: ${data.location}`);
  console.log(`   Height: ${data.height}`);
  console.log(`   Opened: ${data.openedDate}`);
  console.log();

  return data;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Wikipedia – Article Search & Extract");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  📖 Search: "${CFG.searchTerm}"\n`);

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

    // ── Step 1: Search for article ───────────────────────────────────
    await searchArticle(stagehand, page, recorder);

    // ── Step 2: Extract article data ─────────────────────────────────
    const data = await extractArticle(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ DONE");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Summary: ${data.summary.substring(0, 300)}...`);
    console.log(`  Location: ${data.location}`);
    console.log(`  Height: ${data.height}`);
    console.log(`  Opened: ${data.openedDate}`);

    // Save Python script
    const pyScript = genPython(CFG, recorder, data);
    const pyPath = path.join(__dirname, "wikipedia_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    // Save recorded actions
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${jsonPath}`);

    return data;
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
