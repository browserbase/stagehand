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

import os
import re
import time
import traceback
from playwright.sync_api import Playwright, sync_playwright


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

    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport={"width": 1920, "height": 1080},
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
            "--start-maximized",
            "--window-size=1920,1080",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate to Coursera ──────────────────────────────────────────
        print("Loading Coursera...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(${cfg.waits.page})
        print(f"  Loaded: {page.url}\\n")

        # ── Dismiss cookie / popup banners ────────────────────────────────
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
                    btn.click()
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Search for courses ────────────────────────────────────────────
        print(f"Searching for \\"{search_term}\\"...")

        # Click the search input / search button area
        search_selectors = [
            'input[name="query"]',
            'input[type="search"]',
            'input[placeholder*="search" i]',
            'input[placeholder*="What do you want to learn" i]',
            'input[aria-label*="search" i]',
            'button[aria-label*="search" i]',
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
            # Fallback: try clicking on any search icon/button to reveal input
            try:
                page.locator("button[data-testid='search-button'], [aria-label*='Search' i]").first.click()
                page.wait_for_timeout(1000)
                for sel in search_selectors:
                    try:
                        loc = page.locator(sel).first
                        if loc.is_visible(timeout=2000):
                            search_input = loc
                            break
                    except Exception:
                        continue
            except Exception:
                pass

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

        # ── Filter by Free ────────────────────────────────────────────────
        print("Applying Free filter...")
        free_applied = False
        free_selectors = [
            "button:has-text('Free')",
            "label:has-text('Free')",
            "a:has-text('Free')",
            "[data-testid*='free' i]",
            "input[value='free' i]",
        ]
        for sel in free_selectors:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=2000):
                    btn.click()
                    free_applied = True
                    print(f"  Applied filter: {sel}")
                    break
            except Exception:
                continue
        if not free_applied:
            print("  Could not find Free filter, continuing without it")
        page.wait_for_timeout(${cfg.waits.filter})

        # ── Extract results ───────────────────────────────────────────────
        print(f"Extracting up to {max_results} results...\\n")

        # Scroll to load content
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # Try to extract from page text using regex
        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\\n") if l.strip()]

        # Look for rating patterns like "4.8" or enrollment patterns
        seen = set()
        for i, line in enumerate(lines):
            if len(results) >= max_results:
                break
            # Look for rating pattern (e.g., "4.8" standalone or "4.8 (1,234)")
            if re.search(r'^\\d\\.\\d\\b', line):
                # Look backwards for the title (usually 1-5 lines above)
                title = "Unknown"
                provider = "N/A"
                for j in range(max(0, i - 5), i):
                    candidate = lines[j].strip()
                    if candidate and len(candidate) > 10 and "coursera" not in candidate.lower():
                        title = candidate
                        break
                # Provider is usually near the title
                for j in range(max(0, i - 3), i):
                    candidate = lines[j].strip()
                    if candidate and ("university" in candidate.lower() or
                                     "institute" in candidate.lower() or
                                     "google" in candidate.lower() or
                                     "stanford" in candidate.lower() or
                                     "deeplearning" in candidate.lower()):
                        provider = candidate
                        break

                rating = line.split()[0] if line.split() else "N/A"

                # Look for enrollment nearby
                enrollment = "N/A"
                for j in range(max(0, i - 2), min(len(lines), i + 3)):
                    m = re.search(r'([\\d,]+[kKmM]?)\\s*(?:students?|enrolled|learners?)', lines[j], re.IGNORECASE)
                    if m:
                        enrollment = m.group(0)
                        break

                key = title.lower()
                if key not in seen:
                    seen.add(key)
                    results.append({
                        "title": title,
                        "provider": provider,
                        "rating": rating,
                        "enrollment": enrollment,
                    })

        # ── Print results ─────────────────────────────────────────────────
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
        context.close()
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

  // Use AI to find and click the search input
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

  // Submit search
  try {
    await observeAndAct(stagehand, page, recorder,
      "Click the Search button or submit button to search for courses",
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

async function applyFreeFilter(stagehand, page, recorder) {
  console.log("🏷️  Applying Free filter...");

  try {
    await observeAndAct(stagehand, page, recorder,
      "Click the 'Free' filter button or checkbox to filter search results to show only free courses",
      "Apply Free filter",
      CFG.waits.filter
    );
    console.log("   ✅ Free filter applied");
  } catch (e) {
    console.log("   ⚠️  Could not find Free filter, continuing without it");
  }

  await page.waitForTimeout(CFG.waits.filter);
}

async function extractCourses(stagehand, page, recorder) {
  console.log(`🎯 Extracting top ${CFG.maxResults} courses...\n`);
  const { z } = require("zod/v3");

  // Scroll to trigger lazy loading
  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 500)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  // Use AI extract to pull structured data
  const data = await stagehand.extract(
    `Extract up to ${CFG.maxResults} course search results from this Coursera search results page. For each course, get: the course title, the provider or university name, the star rating (e.g. "4.8"), and the enrollment count or number of students/reviews (e.g. "1.2M students" or "245K reviews"). Only extract real course listings, not ads, banners, or headers.`,
    z.object({
      courses: z.array(z.object({
        title: z.string().describe("Course title"),
        provider: z.string().describe("University or organization offering the course"),
        rating: z.string().describe("Star rating, e.g. '4.8'"),
        enrollment: z.string().describe("Enrollment count or number of reviews, e.g. '1.2M students'"),
      })).describe(`Up to ${CFG.maxResults} courses`),
    })
  );

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
  const llmClient = setupLLMClient();
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
