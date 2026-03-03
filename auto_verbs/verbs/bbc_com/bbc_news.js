const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * BBC News – Top Headlines Extraction
 *
 * Navigates to the BBC News homepage, extracts the top 5 headline stories
 * with their headline text and URL.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Configuration ────────────────────────────────────────────────────────────
const CFG = {
  url: "https://www.bbc.com/news",
  maxResults: 5,
  waits: { page: 5000, extract: 3000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
BBC News – Top Headlines Extraction
Extract top ${cfg.maxResults} headline news stories with headline and URL.

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import os, sys, shutil
import traceback
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(
    playwright: Playwright,
    max_results: int = ${cfg.maxResults},
) -> list:
    print("=" * 59)
    print("  BBC News – Top Headlines Extraction")
    print("=" * 59)
    print(f"  Extract up to {max_results} headline stories\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("bbc_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate to BBC News ──────────────────────────────────────────
        print("Loading BBC News...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(${cfg.waits.page})
        print(f"  Loaded: {page.url}\\n")

        # ── Dismiss cookie / consent banners ──────────────────────────────
        for selector in [
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Yes, I agree')",
            "button:has-text('OK')",
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

        # ── Extract headline stories ──────────────────────────────────────
        print(f"Extracting top {max_results} headlines...\\n")

        # Find all card-headline elements directly (more reliable than
        # searching inside card containers which may include nav items).
        headlines_els = page.locator('[data-testid="card-headline"]')
        count = headlines_els.count()
        print(f"  Found {count} card-headline elements")

        seen = set()
        for i in range(count):
            if len(results) >= max_results:
                break
            h_el = headlines_els.nth(i)
            try:
                headline = h_el.inner_text(timeout=2000).strip()
                if not headline:
                    continue

                key = headline.lower()
                if key in seen:
                    continue
                seen.add(key)

                # Walk up to the nearest <a> ancestor to get the URL
                url = h_el.evaluate(
                    """el => {
                        let node = el;
                        while (node) {
                            if (node.tagName === 'A' && node.href) return node.href;
                            node = node.parentElement;
                        }
                        return '';
                    }"""
                ) or "N/A"

                results.append({
                    "headline": headline,
                    "url": url,
                })
            except Exception:
                continue

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} headline stories:\\n")
        for i, story in enumerate(results, 1):
            print(f"  {i}. {story['headline']}")
            print(f"     URL: {story['url']}")
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
        print(f"Total stories: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  // BBC may show cookie consent or notification banners
  const selectors = [
    "button:has-text('Accept')",
    "button:has-text('Accept All')",
    "button:has-text('Yes, I agree')",
    "button:has-text('OK')",
    "button:has-text('Got it')",
    "button:has-text('Close')",
    "[aria-label='Close']",
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel).first;
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        console.log(`   ✅ Dismissed: ${sel}`);
        await page.waitForTimeout(500);
      }
    } catch (e) { /* not visible */ }
  }
  await page.waitForTimeout(500);
}

async function extractHeadlines(stagehand, page, recorder) {
  console.log(`🎯 STEP 1: Extract top ${CFG.maxResults} headlines...\n`);
  const { z } = require("zod/v3");

  // Scroll a bit to ensure content is loaded
  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 400)");
    await page.waitForTimeout(500);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  const result = await stagehand.extract(
    `Extract the top ${CFG.maxResults} headline news stories from this BBC News page. For each story, get: the headline text and the full URL of the story. Only include real news stories, not navigation links, ads, or promotional content.`,
    z.object({
      stories: z.array(z.object({
        headline: z.string().describe("The headline text of the news story"),
        url: z.string().url().describe("The full URL of the story (e.g. https://www.bbc.com/news/...)"),
      })).describe(`Top ${CFG.maxResults} headline news stories`),
    })
  );

  recorder.record("extract", {
    instruction: "Extract top headline news stories",
    description: `Extract up to ${CFG.maxResults} headlines with URLs`,
    results: result,
  });

  console.log(`📋 Found ${result.stories.length} headline stories:`);
  result.stories.forEach((s, i) => {
    console.log(`   ${i + 1}. ${s.headline}`);
    console.log(`      URL: ${s.url}`);
    console.log();
  });

  return result;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  BBC News – Top Headlines Extraction");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  📰 Extract top ${CFG.maxResults} headline stories\n`);

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
        userDataDir: path.join(
          os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
        ),
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-extensions",
          "--start-maximized",
          "--window-size=1920,1080",
        ],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");

    const page = stagehand.context.pages()[0];

    // Navigate to BBC News
    console.log("🌐 Loading BBC News...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    recorder.wait(CFG.waits.page, "Initial page load");
    await page.waitForTimeout(CFG.waits.page);
    console.log(`✅ Loaded: ${page.url()}\n`);

    // Dismiss popups
    await dismissPopups(page);

    // Extract headlines
    const headlines = await extractHeadlines(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${headlines.stories.length} headline stories`);
    console.log("═══════════════════════════════════════════════════════════");
    headlines.stories.forEach((s, i) => {
      console.log(`  ${i + 1}. ${s.headline}`);
      console.log(`     URL: ${s.url}`);
    });

    // Save Python script
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "bbc_news.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    // Save recorded actions
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${jsonPath}`);

    return headlines;

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder);
      fs.writeFileSync(path.join(__dirname, "bbc_news.py"), pyScript, "utf-8");
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
