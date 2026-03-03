const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * GitHub – Repository Search
 *
 * Uses AI-driven discovery to search GitHub for "browser automation" repos,
 * sort by "Most stars", and extract the top 5 with name, owner, stars,
 * language, and description.
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
  url: "https://github.com",
  searchTerm: "browser automation",
  sortBy: "Most stars",
  maxResults: 5,
  waits: { page: 3000, type: 1500, search: 5000 },
};

// ── Temp Profile Helper ──────────────────────────────────────────────────────
function getTempProfileDir() {
  const src = path.join(
    os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
  );
  const tmp = path.join(os.tmpdir(), `github_chrome_profile_${Date.now()}`);
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
GitHub – Repository Search
Search: "${cfg.searchTerm}"
Sort by: ${cfg.sortBy}
Extract up to ${cfg.maxResults} repos with name, owner, stars, language, description.

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
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  GitHub – Repository Search")
    print("=" * 59)
    print(f'  Search: "{search_term}"')
    print(f"  Sort by: ${cfg.sortBy}")
    print(f"  Extract up to {max_results} repos\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("github_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate directly to search results sorted by stars ────────
        search_url = f"https://github.com/search?q={search_term.replace(' ', '+')}&type=repositories&s=stars&o=desc"
        print(f"Loading: {search_url}")
        page.goto(search_url, timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\\n")

        # ── Scroll to load content ────────────────────────────────────
        for _ in range(3):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(500)
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1000)

        # ── Extract results ───────────────────────────────────────────
        print(f"Extracting up to {max_results} repos...\\n")

        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\\n") if l.strip()]

        i = 0
        while i < len(lines) and len(results) < max_results:
            line = lines[i]
            # Look for repo pattern: owner/name
            if "/" in line and not line.startswith("http") and not line.startswith("#"):
                parts = line.split("/")
                if len(parts) == 2 and len(parts[0]) < 40 and len(parts[1]) < 80:
                    owner = parts[0].strip()
                    name = parts[1].strip()
                    # Skip navigation / header items
                    if owner.lower() in ("github", "search", "explore", "topics", "trending", "collections", "events", "about"):
                        i += 1
                        continue

                    repo = {
                        "owner": owner,
                        "name": name,
                        "stars": "N/A",
                        "language": "N/A",
                        "description": "N/A",
                    }

                    # Look ahead for description, stars, language
                    for j in range(i + 1, min(len(lines), i + 10)):
                        cand = lines[j].strip()
                        cl = cand.lower()

                        # Stars count
                        if re.search(r'[\\d,]+\\s*$', cand) and len(cand) < 15:
                            repo["stars"] = cand
                            continue

                        # Language
                        if cand in ("Python", "JavaScript", "TypeScript", "Java", "Go",
                                    "Rust", "C++", "C#", "Ruby", "PHP", "Swift", "Kotlin",
                                    "Shell", "C", "Scala", "R", "Dart", "HTML", "CSS"):
                            repo["language"] = cand
                            continue

                        # Description (longer text without special patterns)
                        if len(cand) > 30 and not cand.startswith("Updated") and "/" not in cand:
                            if repo["description"] == "N/A":
                                repo["description"] = cand

                    # Avoid duplicates
                    key = f"{repo['owner']}/{repo['name']}"
                    if key not in [f"{r['owner']}/{r['name']}" for r in results]:
                        results.append(repo)

            i += 1

        # ── Print results ─────────────────────────────────────────────
        print(f"\\nFound {len(results)} repos:\\n")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['owner']}/{r['name']}")
            print(f"     Stars:       {r['stars']}")
            print(f"     Language:    {r['language']}")
            print(f"     Description: {r['description'][:100]}")
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

async function searchRepos(stagehand, page, recorder) {
  console.log(`🔍 Searching GitHub for "${CFG.searchTerm}"...`);

  // Go directly to GitHub's search results page with sort=stars
  const searchUrl = `https://github.com/search?q=${encodeURIComponent(CFG.searchTerm)}&type=repositories&s=stars&o=desc`;
  console.log(`   Loading: ${searchUrl}`);
  recorder.goto(searchUrl);
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 30000 });
  recorder.wait(CFG.waits.search, "Wait for search results");
  await page.waitForTimeout(CFG.waits.search);
  console.log(`   ✅ Search results loaded: ${page.url()}\n`);

  await dismissPopups(page);
}

async function extractRepos(stagehand, page, recorder) {
  console.log(`🎯 Extracting top ${CFG.maxResults} repos...\n`);
  const { z } = require("zod/v3");

  const schema = z.object({
    repos: z.array(z.object({
      name: z.string().describe("Repository name (without owner)"),
      owner: z.string().describe("Repository owner/organization name"),
      stars: z.string().describe("Number of stars (e.g. '52.3k' or '12,345')"),
      language: z.string().describe("Primary programming language"),
      description: z.string().describe("Repository description"),
    })).describe(`Top ${CFG.maxResults} repositories sorted by most stars`),
  });

  const instruction = `Extract the top ${CFG.maxResults} repository results from this GitHub search results page. For each repo get: (1) the repo name, (2) the owner/org name, (3) the star count, (4) the primary programming language, (5) the description. The results should already be sorted by most stars. Return exactly ${CFG.maxResults} repos.`;

  // Scroll to load content
  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 500)");
    await page.waitForTimeout(400);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  let data = { repos: [] };
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Attempt ${attempt}: Extracting...`);
    try {
      data = await stagehand.extract(instruction, schema);
      if (data.repos.length >= CFG.maxResults) {
        console.log(`   ✅ Extracted ${data.repos.length} repos on attempt ${attempt}`);
        break;
      }
      console.log(`   ⚠️  Attempt ${attempt}: only ${data.repos.length} repos, retrying...`);
      await page.evaluate("window.scrollBy(0, 500)");
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log(`   ⚠️  Attempt ${attempt} failed: ${e.message}`);
    }
  }

  recorder.record("extract", {
    instruction: "Extract repositories via AI",
    description: `Extract top ${CFG.maxResults} repos with name, owner, stars, language, description`,
    results: data,
  });

  console.log(`📋 Found ${data.repos.length} repos:`);
  data.repos.forEach((r, i) => {
    console.log(`   ${i + 1}. ${r.owner}/${r.name}`);
    console.log(`      Stars:       ${r.stars}`);
    console.log(`      Language:    ${r.language}`);
    console.log(`      Description: ${r.description.substring(0, 80)}`);
    console.log();
  });

  return data.repos;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  GitHub – Repository Search");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🔎 Search: "${CFG.searchTerm}"`);
  console.log(`  📊 Sort by: ${CFG.sortBy}`);
  console.log(`  📦 Extract up to ${CFG.maxResults} repos\n`);

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

    // ── Step 1: Navigate to search results ───────────────────────────
    await searchRepos(stagehand, page, recorder);

    // ── Step 2: Extract repos ────────────────────────────────────────
    const repos = await extractRepos(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${repos.length} repos`);
    console.log("═══════════════════════════════════════════════════════════");
    repos.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.owner}/${r.name}`);
      console.log(`     Stars:       ${r.stars}`);
      console.log(`     Language:    ${r.language}`);
      console.log(`     Description: ${r.description.substring(0, 80)}`);
    });

    // Save Python script
    const pyScript = genPython(CFG, recorder, repos);
    const pyPath = path.join(__dirname, "github_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    // Save recorded actions
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${jsonPath}`);

    return repos;
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
