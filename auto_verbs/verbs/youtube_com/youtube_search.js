const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * YouTube Video Search
 *
 * Uses AI-driven discovery to search YouTube for videos.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── YouTube Search Configuration ────────────────────────────────────────────
const YOUTUBE_CONFIG = {
  url: "https://www.youtube.com",
  search: {
    query: "anchorage museums",
    maxResults: 5,
  },
  waitTimes: {
    pageLoad: 3000,
    afterAction: 1000,
    afterSearch: 5000,
  },
};

// ── Python Script Generator ─────────────────────────────────────────────────

function generateYouTubePythonScript(config, recorder) {
  const query = config.search.query;
  const maxResults = config.search.maxResults;
  const ts = new Date().toISOString();
  const nActions = recorder.actions.length;

  return `"""
Auto-generated Playwright script (Python)
YouTube Video Search: "${query}"

Generated on: ${ts}
Recorded ${nActions} browser interactions
Note: This script was generated using AI-driven discovery patterns
"""

import re
import os, sys, shutil
from playwright.sync_api import Playwright, sync_playwright, expect

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(playwright: Playwright, search_query: str = "${query}", max_results: int = ${maxResults}) -> list:
    """
    Search YouTube for the given query and return up to max_results video results,
    each with url, title, and duration.
    """
    port = get_free_port()
    profile_dir = get_temp_profile_dir("youtube_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()

    results = []

    try:
        # Navigate to YouTube
        page.goto("${config.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # Find and fill the search box
        search_input = page.get_by_role("combobox", name=re.compile(r"Search", re.IGNORECASE)).first
        search_input.click()
        search_input.fill(search_query)
        page.wait_for_timeout(500)

        # Submit the search
        search_input.press("Enter")

        # Wait for search results to load
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # Extract video results
        # YouTube video links have /watch?v= in the href
        # Duration is shown as overlay text on the thumbnail
        video_renderers = page.locator("ytd-video-renderer")
        count = video_renderers.count()
        if count == 0:
            # Fallback: try the general video list item
            video_renderers = page.locator("#contents ytd-video-renderer, #contents ytd-rich-item-renderer")
            count = video_renderers.count()

        for i in range(min(count, max_results)):
            renderer = video_renderers.nth(i)
            try:
                # Get the video URL and title from the title link
                title_link = renderer.locator("a#video-title").first
                href = title_link.get_attribute("href", timeout=2000) or ""
                if not href.startswith("http"):
                    href = "https://www.youtube.com" + href
                title = title_link.inner_text(timeout=2000).strip()

                # Get the duration from the time-status overlay
                duration = "N/A"
                try:
                    time_el = renderer.locator("span#text.ytd-thumbnail-overlay-time-status-renderer, badge-shape .badge-shape-wiz__text, span.ytd-thumbnail-overlay-time-status-renderer").first
                    duration = time_el.inner_text(timeout=2000).strip()
                except Exception:
                    # Try alternative: the time display in the thumbnail
                    try:
                        time_el = renderer.locator("[overlay-style='DEFAULT'] span").first
                        duration = time_el.inner_text(timeout=2000).strip()
                    except Exception:
                        pass

                results.append({"url": href, "title": title, "duration": duration})
            except Exception:
                continue

        if not results:
            # Fallback: extract video links from page
            print("Primary extraction failed, trying link-based fallback...")
            all_links = page.get_by_role("link").all()
            seen = set()
            for link in all_links:
                try:
                    href = link.get_attribute("href", timeout=500) or ""
                    if "/watch?v=" in href and href not in seen:
                        seen.add(href)
                        if not href.startswith("http"):
                            href = "https://www.youtube.com" + href
                        label = link.inner_text(timeout=500).strip() or "N/A"
                        results.append({"url": href, "title": label, "duration": "N/A"})
                        if len(results) >= max_results:
                            break
                except Exception:
                    continue

        if not results:
            print("Warning: Could not find any video results.")

        # Print results
        print(f"\\nFound {len(results)} video results for '{search_query}':\\n")
        for i, item in enumerate(results, 1):
            print(f"  {i}. {item['title']}")
            print(f"     URL: {item['url']}")
            print(f"     Duration: {item['duration']}")

    except Exception as e:
        print(f"Error searching YouTube: {e}")
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
        print(f"\\nTotal videos found: {len(items)}")
`;
}

// ── Stagehand Discovery Steps ───────────────────────────────────────────────

async function discoverYouTubeInterface(stagehand, recorder) {
  console.log("🔍 STEP 1: Exploring the YouTube interface...\n");

  const { z } = require("zod/v3");

  const interfaceDiscovery = await stagehand.extract(
    "Analyze the current YouTube homepage. What search inputs, buttons, or controls are visible? Look for the main search box.",
    z.object({
      availableOptions: z.array(z.string()).describe("List of visible options/buttons/controls"),
      searchRelated: z.array(z.string()).describe("Options related to searching for videos"),
      otherControls: z.array(z.string()).describe("Other notable controls or features"),
    })
  );

  recorder.record("extract", {
    instruction: "Analyze the current YouTube homepage interface",
    description: "Interface discovery analysis",
    results: interfaceDiscovery,
  });

  console.log("📋 Interface Discovery Results:");
  console.log(`   🎯 Available options: ${interfaceDiscovery.availableOptions.join(", ")}`);
  console.log(`   🔍 Search-related: ${interfaceDiscovery.searchRelated.join(", ")}`);
  console.log(`   ⚙️  Other controls: ${interfaceDiscovery.otherControls.join(", ")}`);
  console.log("");

  return interfaceDiscovery;
}

async function searchForVideos(stagehand, page, recorder, query) {
  console.log(`🎯 STEP 2: Searching for "${query}"...\n`);

  // Click on the search box
  console.log("🎯 Clicking the search box...");
  await observeAndAct(stagehand, page, recorder,
    "Click on the YouTube 'Search' input field at the top of the page",
    "Click search input",
    500
  );

  // Type the search query
  console.log(`🎯 Typing search query: "${query}"...`);
  await observeAndAct(stagehand, page, recorder,
    `Type '${query}' into the currently focused search input field`,
    `Type search query: ${query}`,
    YOUTUBE_CONFIG.waitTimes.afterAction
  );

  // Press Enter to submit
  console.log("🎯 Pressing Enter to submit search...");
  await observeAndAct(stagehand, page, recorder,
    "Press Enter key to submit the search query",
    "Submit search with Enter",
    YOUTUBE_CONFIG.waitTimes.afterSearch
  );

  // Wait for results to load
  console.log("⏳ Waiting for search results...");
  recorder.wait(5000, "Wait for search results to load");
  await page.waitForTimeout(5000);
}

async function extractVideoResults(stagehand, page, recorder, maxResults) {
  console.log(`🎯 STEP 3: Extracting up to ${maxResults} video results...\n`);

  const { z } = require("zod/v3");

  const listings = await stagehand.extract(
    `Extract the video search results visible on the page. For each video, get the video URL (the /watch?v=... link), the video title, and the video duration. Get at most ${maxResults} videos. Only include actual video results, not ads or channel links.`,
    z.object({
      videos: z.array(
        z.object({
          url: z.string().describe("Full YouTube video URL (https://www.youtube.com/watch?v=...)"),
          title: z.string().describe("Video title"),
          duration: z.string().describe("Video duration (e.g. '12:34', '1:23:45')"),
        })
      ).describe(`List of video results (at most ${maxResults})`),
    })
  );

  recorder.record("extract", {
    instruction: "Extract video search results",
    description: `Extract up to ${maxResults} video results with URL, title, and duration`,
    results: listings,
  });

  console.log(`\n📋 Found ${listings.videos.length} videos:`);
  listings.videos.forEach((item, i) => {
    console.log(`   ${i + 1}. ${item.title}`);
    console.log(`      🔗 URL: ${item.url}`);
    console.log(`      ⏱️  Duration: ${item.duration}`);
  });

  return listings;
}

// ── Main Function ───────────────────────────────────────────────────────────

async function searchYouTube() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  YouTube – Video Search");
  console.log("  🔍 Discover the interface dynamically (like a human would)");
  console.log("  📝 Recording interactions → Python Playwright script");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");

  let stagehand;
  try {
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 1,
      llmClient: llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
        headless: false,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-extensions",
          "--start-maximized",
        ],
      },
    });

    await stagehand.init();
    console.log("✅ Stagehand initialized!\n");

    const page = stagehand.context.pages()[0];

    // Navigate to YouTube
    console.log("🌐 Navigating to YouTube...");
    recorder.goto(YOUTUBE_CONFIG.url);
    await page.goto(YOUTUBE_CONFIG.url);
    await page.waitForLoadState("networkidle");
    console.log("✅ YouTube loaded\n");

    recorder.wait(YOUTUBE_CONFIG.waitTimes.pageLoad, "Wait for YouTube to fully render");
    await page.waitForTimeout(YOUTUBE_CONFIG.waitTimes.pageLoad);

    // Step 1: Interface Discovery
    await discoverYouTubeInterface(stagehand, recorder);

    // Step 2: Search for Videos
    await searchForVideos(stagehand, page, recorder, YOUTUBE_CONFIG.search.query);

    // Step 3: Extract Results
    const listings = await extractVideoResults(stagehand, page, recorder, YOUTUBE_CONFIG.search.maxResults);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ COMPLETE!");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  🔍 Query: "${YOUTUBE_CONFIG.search.query}"`);
    console.log(`  🎬 Found ${listings.videos.length} videos:`);
    listings.videos.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.title} - ${item.url} (${item.duration})`);
    });
    console.log("═══════════════════════════════════════════════════════════");

    // Generate Python Playwright script
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  Generating Python Playwright script...");
    console.log("═══════════════════════════════════════════════════════════\n");

    const pythonScript = generateYouTubePythonScript(YOUTUBE_CONFIG, recorder);
    const pythonPath = path.join(__dirname, "youtube_search.py");
    fs.writeFileSync(pythonPath, pythonScript, "utf-8");
    console.log(`✅ Python script preserved (hand-maintained via CDP)`);

    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Raw actions log saved: ${jsonPath}`);

    console.log("");
    console.log("═══════════════════════════════════════════════════════════\n");

    return listings;

  } catch (error) {
    console.error("\n❌ Error:", error.message);

    if (recorder && recorder.actions.length > 0) {
      console.log("\n⚠️  Saving partial recording...");
      const pythonScript = generateYouTubePythonScript(YOUTUBE_CONFIG, recorder);
      const pythonPath = path.join(__dirname, "youtube_search.py");
      fs.writeFileSync(pythonPath, pythonScript, "utf-8");
      console.log(`🐍 Python script preserved (hand-maintained via CDP)`);

      const jsonPath = path.join(__dirname, "recorded_actions.json");
      fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
      console.log(`📋 Partial actions log saved: ${jsonPath}`);
    }

    throw error;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing browser...");
      await stagehand.close();
    }
  }
}

// ── Entry Point ─────────────────────────────────────────────────────────────
if (require.main === module) {
  searchYouTube()
    .then(() => {
      console.log("🎊 Completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Failed:", error.message);
      process.exit(1);
    });
}

module.exports = { searchYouTube };
