const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Coursera – Course Search
 *
 * Uses AI-driven discovery to search coursera.org for "machine learning" courses,
 * filter by "Free" availability, and extract the top 5 results with title,
 * provider (university), rating, and enrollment count.
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
  url: "https://www.coursera.org",
  searchTerm: "machine learning",
  maxResults: 5,
  waits: { page: 4000, type: 1500, search: 6000, filter: 4000 },
};

// ── Temp Profile Helper ──────────────────────────────────────────────────────
function getTempProfileDir() {
  const src = path.join(
    os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
  );
  const tmp = path.join(os.tmpdir(), `coursera_chrome_profile_${Date.now()}`);
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
Coursera – Course Search
Search: "${cfg.searchTerm}"
Filter: Free
Extract up to ${cfg.maxResults} courses with title, provider, rating, enrollment.

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
    print("  Coursera – Course Search")
    print("=" * 59)
    print(f"  Search: \\"{search_term}\\"")
    print(f"  Filter: Free")
    print(f"  Extract up to {max_results} results\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("coursera_org")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate to search results directly ──────────────────────
        from urllib.parse import quote_plus
        search_url = f"https://www.coursera.org/search?query={quote_plus(search_term)}&productFree=true"
        print(f"Loading: {search_url}")
        page.goto(search_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\\n")

        # ── Dismiss cookie / popup banners ────────────────────────────
        for sel in [
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Got it')",
            "[aria-label='Close']",
            "#onetrust-accept-btn-handler",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Extract results ───────────────────────────────────────────
        print(f"Extracting up to {max_results} results...\\n")

        # Scroll to load content
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Extract using page text with heuristics
        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\\n") if l.strip()]

        # Lines to skip when looking for course titles
        skip_prefixes = [
            "status:", "skills you", "coursera", "filter", "sort",
            "topic", "duration", "language", "level", "learning product",
            "all results", "show more", "you might", "skip to",
            "for individuals", "for businesses", "for universities",
            "for governments", "explore", "degrees", "log in", "join",
            "ai overview", "understanding", "start with", "begin with",
            "learn about", "build skills", "enhance your",
            "multiple educators",
        ]

        seen = set()
        for i, line in enumerate(lines):
            if len(results) >= max_results:
                break
            # Look for rating patterns like "4.8" or "4.9(10K reviews)"
            if re.search(r'^\\d\\.\\d\\b', line):
                title = "Unknown"
                provider = "N/A"
                enrollment = "N/A"

                for j in range(i - 1, max(0, i - 8), -1):
                    cand = lines[j].strip()
                    cl = cand.lower()
                    if not cand or len(cand) < 5:
                        continue
                    if any(cl.startswith(p) for p in skip_prefixes):
                        continue
                    if provider == "N/A" and any(kw in cl for kw in [
                        "university", "institute", "google", "stanford",
                        "deeplearning", "ibm", "meta", "microsoft",
                        "aws", "duke", "johns hopkins",
                    ]):
                        provider = cand
                        continue
                    if title == "Unknown" and len(cand) > 8:
                        title = cand

                # Look for review/enrollment count near the rating
                for j in range(max(0, i - 1), min(len(lines), i + 4)):
                    m = re.search(
                        r'[\\d,.]+[kKmM]?\\s*(?:students?|enrolled|learners?|reviews?|ratings?)',
                        lines[j], re.IGNORECASE
                    )
                    if m:
                        enrollment = m.group(0)
                        break

                rating = line.split()[0] if line.split() else "N/A"
                key = title.lower()
                if key not in seen and title != "Unknown":
                    seen.add(key)
                    results.append({
                        "title": title,
                        "provider": provider,
                        "rating": rating,
                        "enrollment": enrollment,
                    })

        # ── Print results ─────────────────────────────────────────────
        print(f"\\nFound {len(results)} courses:\\n")
        for i, c in enumerate(results, 1):
            print(f"  {i}. {c['title']}")
            print(f"     Provider:   {c['provider']}")
            print(f"     Rating:     {c['rating']}")
            print(f"     Enrollment: {c['enrollment']}")
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
    "button:has-text('Got it')",
    "[aria-label='Close']",
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

async function searchCourses(stagehand, page, recorder) {
  console.log(`🔍 Searching for "${CFG.searchTerm}"...`);

  // Approach 1: Try the UI search first
  let navigated = false;
  try {
    await observeAndAct(stagehand, page, recorder,
      "Click the search input field or search icon where you can type to search for courses",
      "Click search input"
    );
    await page.waitForTimeout(500);

    // Ctrl+A then type (per SystemPrompt1.txt)
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

    // Submit via Enter key
    await stagehand.act("Press Enter to submit the search form");
    recorder.record("press", { key: "Enter", description: "Submit search" });
    console.log("   ✅ Pressed Enter");

    await page.waitForTimeout(CFG.waits.search);

    // Check if the URL changed (i.e. we're on a search results page)
    const currentUrl = page.url();
    if (currentUrl.includes("/search") || currentUrl.includes("query=")) {
      navigated = true;
      console.log(`   ✅ Results loaded via UI: ${currentUrl}\n`);
    }
  } catch (e) {
    console.log(`   ⚠️  UI search failed: ${e.message}`);
  }

  // Approach 2: If UI search didn't navigate, go directly to search URL
  if (!navigated) {
    const searchUrl = `${CFG.url}/search?query=${encodeURIComponent(CFG.searchTerm)}`;
    console.log(`   🔄 UI search didn't navigate, going directly to: ${searchUrl}`);
    recorder.goto(searchUrl);
    await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(CFG.waits.search);
    console.log(`   ✅ Results loaded via direct URL: ${page.url()}\n`);
  }
}

async function applyFreeFilter(stagehand, page, recorder) {
  console.log("🏷️  Applying Free filter via URL...");

  // Use URL parameter directly — avoids opening the Filter & Sort side pane
  // which can obscure course cards and block extraction.
  const currentUrl = page.url();
  if (currentUrl.includes("/search")) {
    const separator = currentUrl.includes("?") ? "&" : "?";
    const freeUrl = `${currentUrl}${separator}productFree=true`;
    console.log(`   URL: ${freeUrl}`);
    recorder.goto(freeUrl);
    await page.goto(freeUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(CFG.waits.filter);
    console.log(`   ✅ Free filter applied: ${page.url()}`);
  } else {
    console.log("   ⚠️  Not on search page, skipping filter");
  }

  await page.waitForTimeout(CFG.waits.filter);
}

async function extractCourses(stagehand, page, recorder) {
  console.log(`🎯 Extracting top ${CFG.maxResults} courses...\n`);
  const { z } = require("zod/v3");

  const schema = z.object({
    courses: z.array(z.object({
      title: z.string().describe("The course title from the card"),
      provider: z.string().describe("University or organization name from the card"),
      rating: z.string().describe("Star rating from the card, e.g. '4.8'"),
      enrollment: z.string().describe("Review or enrollment count from the card, e.g. '1.2K reviews' or '650K students'"),
    })).describe(`First ${CFG.maxResults} course cards with ratings`),
  });

  const instruction = `Extract the first ${CFG.maxResults} course result CARDS from this Coursera search results page. Do NOT extract from the "AI Overview" text summary at the top. Look for the actual course result cards below, which each have a course title, a provider/university name, a star rating (like 4.8), and a review or enrollment count (like "1.2K reviews" or "4.6M students"). Each card represents one course listing.`;

  // Scroll down progressively to trigger lazy loading and get past AI Overview
  console.log("   Scrolling down to load course cards...");
  for (let i = 0; i < 10; i++) {
    await page.evaluate("window.scrollBy(0, 500)");
    await page.waitForTimeout(400);
  }
  // Scroll back up to where the course cards start (below AI Overview)
  await page.evaluate("window.scrollTo(0, 1200)");
  await page.waitForTimeout(3000);

  // Try extraction up to 3 times
  let data = { courses: [] };
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Attempt ${attempt}: Extracting...`);

    try {
      data = await stagehand.extract(instruction, schema);
      // Check if we got ratings (not just titles from AI Overview)
      const hasRatings = data.courses.some(c => c.rating && c.rating.trim() !== "");
      if (data.courses.length > 0 && hasRatings) {
        console.log(`   ✅ Extracted ${data.courses.length} courses with ratings on attempt ${attempt}`);
        break;
      }
      console.log(`   ⚠️  Attempt ${attempt}: ${data.courses.length} courses but missing ratings, scrolling more...`);
      // Scroll further down to see the actual cards
      await page.evaluate("window.scrollBy(0, 800)");
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log(`   ⚠️  Attempt ${attempt} failed: ${e.message}`);
      await page.evaluate("window.scrollBy(0, 600)");
      await page.waitForTimeout(2000);
    }
  }

  recorder.record("extract", {
    instruction: "Extract course search results via AI",
    description: `Extract up to ${CFG.maxResults} courses with title, provider, rating, enrollment`,
    results: data,
  });

  console.log(`📋 Found ${data.courses.length} courses:`);
  data.courses.forEach((c, i) => {
    console.log(`   ${i + 1}. ${c.title}`);
    console.log(`      Provider:   ${c.provider}`);
    console.log(`      Rating:     ${c.rating}`);
    console.log(`      Enrollment: ${c.enrollment}`);
    console.log();
  });

  return data.courses;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Coursera – Course Search");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🔍 Search: "${CFG.searchTerm}"`);
  console.log(`  🏷️  Filter: Free`);
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

    // ── Step 1: Navigate to Coursera ─────────────────────────────────
    console.log(`🌐 Loading Coursera...`);
    console.log(`   URL: ${CFG.url}`);
    recorder.goto(CFG.url);
    await page.goto(CFG.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    recorder.wait(CFG.waits.page, "Wait for page load");
    await page.waitForTimeout(CFG.waits.page);
    console.log(`✅ Loaded: ${page.url()}\n`);

    // Dismiss popups
    await dismissPopups(page);

    // ── Step 2: Search for courses ───────────────────────────────────
    await searchCourses(stagehand, page, recorder);

    // ── Step 3: Apply Free filter ────────────────────────────────────
    await applyFreeFilter(stagehand, page, recorder);

    // ── Step 4: Extract courses ──────────────────────────────────────
    const courses = await extractCourses(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${courses.length} courses`);
    console.log("═══════════════════════════════════════════════════════════");
    courses.forEach((c, i) => {
      console.log(`  ${i + 1}. ${c.title}`);
      console.log(`     Provider:   ${c.provider}`);
      console.log(`     Rating:     ${c.rating}`);
      console.log(`     Enrollment: ${c.enrollment}`);
    });

    // Save Python script
    const pyScript = genPython(CFG, recorder, courses);
    const pyPath = path.join(__dirname, "coursera_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    // Save recorded actions
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${jsonPath}`);

    return courses;

  } catch (err) {
    console.log("\n❌ Error:", err.message);
    console.log("Stack:", err.stack);
    fs.writeFileSync(path.join(__dirname, "error.log"),
      `${new Date().toISOString()}\n${err.message}\n\n${err.stack}`, "utf-8");
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder, []);
      fs.writeFileSync(path.join(__dirname, "coursera_search.py"), pyScript, "utf-8");
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
