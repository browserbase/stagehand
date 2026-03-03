const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Weather.com – Weather Forecast
 *
 * Uses AI-driven discovery to search weather.com for the weather in
 * "Seattle, WA", then extracts the current temperature, conditions,
 * and the 5-day forecast with day name, high/low temps, and conditions.
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
  url: "https://weather.com",
  location: "Seattle, WA",
  waits: { page: 4000, type: 1500, search: 5000 },
};

// ── Temp Profile Helper ──────────────────────────────────────────────────────
function getTempProfileDir() {
  const src = path.join(
    os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
  );
  const tmp = path.join(os.tmpdir(), `weather_chrome_profile_${Date.now()}`);
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
Weather.com – Weather Forecast
Location: "${cfg.location}"
Extract: current temperature, conditions, 5-day forecast.

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
    location: str = "${cfg.location}",
) -> dict:
    print("=" * 59)
    print("  Weather.com – Weather Forecast")
    print("=" * 59)
    print(f'  Location: "{location}"\\n')
    port = get_free_port()
    profile_dir = get_temp_profile_dir("weather_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    result = {"current": {}, "forecast": []}

    try:
        # ── Navigate to weather.com ───────────────────────────────────
        print(f"Loading: ${cfg.url}")
        page.goto("${cfg.url}", timeout=30000)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(3000)

        # ── Dismiss popups ────────────────────────────────────────────
        for sel in [
            "#onetrust-accept-btn-handler",
            "button.onetrust-close-btn-handler",
            "button:has-text('Accept All')",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('No, thanks')",
            "[data-testid='close-button']",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Search for location ───────────────────────────────────────
        print(f'Searching for "{location}"...')
        search_input = page.locator(
            "#LocationSearch_input, "
            "input[id*='LocationSearch'], "
            "input[placeholder*='Search City']"
        ).first
        search_input.evaluate("el => el.click()")
        page.wait_for_timeout(500)
        search_input.press("Control+a")
        search_input.fill(location)
        page.wait_for_timeout(2000)

        # Click the first suggestion
        try:
            suggestion = page.locator(
                "[data-testid='searchItem'], "
                "button[id*='LocationSearch_listItem']"
            ).first
            suggestion.wait_for(state="visible", timeout=5000)
            suggestion.evaluate("el => el.click()")
        except Exception:
            search_input.press("Enter")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}\\n")

        # ── Extract current conditions ────────────────────────────────
        print("Extracting current conditions...")
        try:
            temp_el = page.locator("[data-testid='TemperatureValue'], .CurrentConditions--tempValue--*").first
            result["current"]["temperature"] = temp_el.inner_text(timeout=5000).strip()
        except Exception:
            result["current"]["temperature"] = "N/A"

        try:
            cond_el = page.locator("[data-testid='wxPhrase'], .CurrentConditions--phraseValue--*").first
            result["current"]["conditions"] = cond_el.inner_text(timeout=3000).strip()
        except Exception:
            result["current"]["conditions"] = "N/A"

        # ── Navigate to 5-day forecast ────────────────────────────────
        print("Navigating to 5-day forecast...")
        try:
            link = page.locator("a[href*='5day'], a:has-text('5 Day')").first
            if link.is_visible(timeout=3000):
                link.evaluate("el => el.click()")
                page.wait_for_timeout(4000)
        except Exception:
            # Try appending /weather/5day to URL
            current_url = page.url
            if "/weather/" in current_url and "/5day" not in current_url:
                five_day_url = current_url.split("/weather/")[0] + "/weather/5day/" + current_url.split("/weather/")[1].split("/")[1] if "/weather/" in current_url else current_url
                page.goto(five_day_url, timeout=15000)
                page.wait_for_timeout(3000)

        # ── Extract 5-day forecast ────────────────────────────────────
        print("Extracting 5-day forecast...")
        body_text = page.evaluate("document.body.innerText") or ""
        lines = [l.strip() for l in body_text.split("\\n") if l.strip()]

        day_names = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday",
                     "Saturday", "Sunday", "Today", "Tonight"]
        for i, line in enumerate(lines):
            if any(line.startswith(d) for d in day_names) and len(result["forecast"]) < 5:
                day = {"day": line, "high": "N/A", "low": "N/A", "conditions": "N/A"}
                # Look ahead for temps and conditions
                for j in range(i + 1, min(len(lines), i + 8)):
                    cand = lines[j]
                    # Temperature pattern
                    temp_match = re.search(r'(\\d+)°\\s*/\\s*(\\d+)°', cand)
                    if temp_match:
                        day["high"] = temp_match.group(1) + "°"
                        day["low"] = temp_match.group(2) + "°"
                        continue
                    if re.match(r'^\\d+°$', cand) and day["high"] == "N/A":
                        day["high"] = cand
                        continue
                    if re.match(r'^\\d+°$', cand) and day["low"] == "N/A":
                        day["low"] = cand
                        continue
                    # Conditions — common weather words
                    if any(w in cand.lower() for w in ["rain", "sun", "cloud", "snow",
                            "clear", "thunder", "fog", "overcast", "partly", "mostly",
                            "showers", "drizzle", "windy", "fair"]):
                        if day["conditions"] == "N/A":
                            day["conditions"] = cand
                result["forecast"].append(day)

        # ── Print results ─────────────────────────────────────────────
        print(f"\\n{'=' * 59}")
        print("  Results")
        print(f"{'=' * 59}")
        print(f"\\n  Current Conditions:")
        print(f"     Temperature: {result['current'].get('temperature', 'N/A')}")
        print(f"     Conditions:  {result['current'].get('conditions', 'N/A')}")
        print(f"\\n  5-Day Forecast:")
        for i, d in enumerate(result["forecast"], 1):
            print(f"     {i}. {d['day']}: High {d['high']}, Low {d['low']} — {d['conditions']}")
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
        print(f"Done — current temp: {data['current'].get('temperature', 'N/A')}, {len(data['forecast'])} forecast days")
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
    "button:has-text('No, thanks')",
    "[data-testid='close-button']",
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
  console.log(`🔍 Searching for weather in "${CFG.location}"...`);

  console.log(`   Loading: ${CFG.url}`);
  recorder.goto(CFG.url);
  await page.goto(CFG.url, { waitUntil: "domcontentloaded", timeout: 30000 });
  recorder.wait(CFG.waits.page, "Wait for weather.com");
  await page.waitForTimeout(CFG.waits.page);
  console.log(`   ✅ Weather.com loaded: ${page.url()}`);

  await dismissPopups(page);

  // Use AI to find and interact with the search box
  await observeAndAct(stagehand, page, recorder,
    `Click the location/city search input field on weather.com where you can type a city name to get weather forecasts.`,
    "Click location search input"
  );
  await page.waitForTimeout(500);

  await stagehand.act("Press Control+A to select all text in the search input");
  await page.waitForTimeout(200);

  await stagehand.act(`Type '${CFG.location}' into the search input field`);
  recorder.record("fill", {
    selector: "location search input",
    value: CFG.location,
    description: `Type "${CFG.location}" in the search box`,
  });
  console.log(`   ✅ Typed: "${CFG.location}"`);
  await page.waitForTimeout(2000);

  // Click first suggestion
  try {
    await observeAndAct(stagehand, page, recorder,
      `Click the first location suggestion/result in the dropdown that appeared after typing "${CFG.location}".`,
      "Click first location suggestion"
    );
  } catch (e) {
    console.log(`   ⚠️  No suggestion found, pressing Enter...`);
    await stagehand.act("Press Enter to submit the search");
  }
  recorder.record("press", { key: "Enter", description: "Submit location search" });

  await page.waitForTimeout(CFG.waits.search);
  console.log(`   ✅ Weather page loaded: ${page.url()}\n`);
}

async function extractWeather(stagehand, page, recorder) {
  console.log("🎯 Extracting weather data...\n");
  const { z } = require("zod/v3");

  const schema = z.object({
    currentTemperature: z.string().describe("Current temperature (e.g. '45°F' or '45°')"),
    currentConditions: z.string().describe("Current weather conditions description (e.g. 'Partly Cloudy', 'Rain')"),
    forecast: z.array(z.object({
      day: z.string().describe("Day name (e.g. 'Monday', 'Today')"),
      high: z.string().describe("High temperature for the day"),
      low: z.string().describe("Low temperature for the day"),
      conditions: z.string().describe("Weather conditions for the day"),
    })).describe("5-day forecast"),
  });

  const instruction = `Extract the weather data for ${CFG.location} from this page:
1. Current temperature and current conditions/description.
2. The 5-day forecast — for each day: the day name, high temperature, low temperature, and conditions/description.
If the 5-day forecast is not on this page, extract what daily forecast information is visible (like "Today" section or nearby days).`;

  // Scroll to see more content
  for (let i = 0; i < 4; i++) {
    await page.evaluate("window.scrollBy(0, 500)");
    await page.waitForTimeout(300);
  }
  await page.evaluate("window.scrollTo(0, 0)");
  await page.waitForTimeout(1000);

  let data = { currentTemperature: "N/A", currentConditions: "N/A", forecast: [] };
  for (let attempt = 1; attempt <= 3; attempt++) {
    console.log(`   Attempt ${attempt}: Extracting...`);
    try {
      data = await stagehand.extract(instruction, schema);
      if (data.currentTemperature !== "N/A" && data.forecast.length > 0) {
        console.log(`   ✅ Extracted weather data on attempt ${attempt}`);
        break;
      }
      console.log(`   ⚠️  Attempt ${attempt}: incomplete, retrying...`);
      await page.evaluate("window.scrollBy(0, 600)");
      await page.waitForTimeout(2000);
    } catch (e) {
      console.log(`   ⚠️  Attempt ${attempt} failed: ${e.message}`);
    }
  }

  recorder.record("extract", {
    instruction: "Extract weather data via AI",
    description: "Extract current temp, conditions, 5-day forecast",
    results: data,
  });

  console.log("📋 Weather Data:");
  console.log(`   Current: ${data.currentTemperature}, ${data.currentConditions}`);
  console.log("   5-Day Forecast:");
  data.forecast.forEach((d, i) => {
    console.log(`     ${i + 1}. ${d.day}: High ${d.high}, Low ${d.low} — ${d.conditions}`);
  });
  console.log();

  return data;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Weather.com – Weather Forecast");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🌤️  Location: "${CFG.location}"\n`);

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

    // ── Step 1: Search for location ──────────────────────────────────
    await searchLocation(stagehand, page, recorder);

    // ── Step 2: Extract weather data ─────────────────────────────────
    const data = await extractWeather(stagehand, page, recorder);

    // Summary
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log("  ✅ DONE");
    console.log("═══════════════════════════════════════════════════════════");
    console.log(`  Current: ${data.currentTemperature}, ${data.currentConditions}`);
    data.forecast.forEach((d, i) => {
      console.log(`  ${i + 1}. ${d.day}: High ${d.high}, Low ${d.low} — ${d.conditions}`);
    });

    // Save Python script
    const pyScript = genPython(CFG, recorder, data);
    const pyPath = path.join(__dirname, "weather_search.py");
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
