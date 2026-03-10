const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

/**
 * Ctrip – Train Ticket Search
 *
 * Uses AI-driven discovery to interact with Ctrip's train search.
 * Records interactions and generates a Python Playwright script.
 * Does not take any screenshots.
 */

// ── Configuration ────────────────────────────────────────────────────────────
function computeDate() {
  const today = new Date();
  const departure = new Date(today);
  departure.setDate(today.getDate() + 4);
  const fmt = (d) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { departure: fmt(departure) };
}
const dates = computeDate();

const CFG = {
  url: "https://trains.ctrip.com/",
  from: "上海",
  to: "福州",
  departure: dates.departure,
  maxResults: 5,
  waits: { page: 3000, type: 2000, select: 1000, search: 5000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Auto-generated Playwright script (Python)
Ctrip – Train Ticket Search
From: ${cfg.from}  To: ${cfg.to}
Departure: ${cfg.departure}  (One-way, 1 adult)

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with CDP connection to real Chrome.
Navigates directly to the search results URL (Ctrip's React form is hard
to automate via normal Playwright typing).
"""

import re
import os, sys, shutil
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def compute_departure():
    today = date.today()
    departure = today + timedelta(days=4)
    return departure


def run(
    playwright: Playwright,
    from_station: str = "${cfg.from}",
    to_station: str = "${cfg.to}",
    max_results: int = ${cfg.maxResults},
) -> list:
    departure = compute_departure()
    departure_str = departure.strftime("%Y-%m-%d")

    print(f"  From: {from_station}  To: {to_station}")
    print(f"  Departure: {departure_str}  (One-way, 1 adult)\\n")
    port = get_free_port()
    profile_dir = get_temp_profile_dir("ctrip")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []

    try:
        # ── Navigate directly to search results ──────────────────────────
        from urllib.parse import quote
        search_url = (
            f"https://trains.ctrip.com/webapp/train/list"
            f"?ticketType=0"
            f"&dStation={quote(from_station)}"
            f"&aStation={quote(to_station)}"
            f"&dDate={departure_str}"
            f"&rDate=&trainsNo=&from=trains_mainpage"
        )
        print(f"Loading search results: {search_url}")
        page.goto(search_url)
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(8000)
        print(f"  Loaded: {page.url}")

        # ── Dismiss popups / cookie banners ───────────────────────────────
        for selector in [
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
            "button:has-text('知道了')",
            "button:has-text('关闭')",
            ".close-btn",
        ]:
            try:
                btn = page.locator(selector).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # ── Extract train results ─────────────────────────────────────────
        print(f"Extracting up to {max_results} trains...")

        # Try extracting from train list items
        train_items = page.locator(
            '.train-list .list-item, '
            '[class*="train-list"] [class*="item"], '
            '[class*="trainItem"], '
            '[class*="list-item"]'
        )
        count = train_items.count()
        print(f"  Found {count} train items")

        for i in range(min(count, max_results)):
            item = train_items.nth(i)
            try:
                text = item.inner_text(timeout=3000)
                lines = [l.strip() for l in text.split("\\n") if l.strip()]
                dep_time = arr_time = duration = price = train_no = "N/A"
                for line in lines:
                    # Train number (G/D/K/Z/T followed by digits)
                    tn_m = re.search(r"([GDKZT]\\d+)", line)
                    if tn_m and train_no == "N/A":
                        train_no = tn_m.group(1)
                        continue  # skip this line for other extraction
                    # Times HH:MM
                    tm = re.findall(r"\\d{2}:\\d{2}", line)
                    if len(tm) >= 2 and dep_time == "N/A":
                        dep_time, arr_time = tm[0], tm[1]
                        continue
                    elif len(tm) == 1 and dep_time == "N/A":
                        dep_time = tm[0]
                        continue
                    elif len(tm) == 1 and dep_time != "N/A" and arr_time == "N/A":
                        arr_time = tm[0]
                        continue
                    # Duration
                    dur_m = re.search(r"(\\d+[时h])?\\s*(\\d+[分m])", line)
                    if dur_m and duration == "N/A":
                        duration = dur_m.group(0).strip()
                        continue
                    # Price — may have ¥/￥ prefix or be a plain number
                    price_m = re.search(r"[¥￥](\\d+\\.?\\d*)", line)
                    if price_m and price == "N/A":
                        price = "¥" + price_m.group(1)
                    elif price == "N/A" and ":" not in line:
                        # Look for standalone numbers that look like prices
                        plain_m = re.search(r"(\\d{2,}(?:\\.\\d+)?)", line)
                        if plain_m:
                            val = plain_m.group(1)
                            price = "¥" + val
                results.append({
                    "train_number": train_no,
                    "departure_time": dep_time,
                    "arrival_time": arr_time,
                    "duration": duration,
                    "price": price,
                })
            except Exception:
                continue

        # Fallback: parse entire page text
        if not results:
            print("  Item extraction failed, trying page text fallback...")
            body_text = page.evaluate("document.body.innerText") or ""
            lines = body_text.split("\\n")
            for line in lines:
                if len(results) >= max_results:
                    break
                tn_m = re.search(r"([GDKZT]\\d+)", line)
                times = re.findall(r"\\d{2}:\\d{2}", line)
                price_m = re.search(r"[¥￥](\\d+\\.?\\d*)", line)
                if tn_m and len(times) >= 2 and price_m:
                    results.append({
                        "train_number": tn_m.group(1),
                        "departure_time": times[0],
                        "arrival_time": times[1],
                        "duration": "N/A",
                        "price": "¥" + price_m.group(1),
                    })

        # ── Print results ─────────────────────────────────────────────────
        print(f"\\nFound {len(results)} trains from '{from_station}' to '{to_station}':")
        print(f"  Departure: {departure_str}  (One-way, 1 adult)\\n")
        for i, train in enumerate(results, 1):
            print(f"  {i}. {train['train_number']}  Dep: {train['departure_time']}  Arr: {train['arrival_time']}  Duration: {train['duration']}  Price: {train['price']}")

    except Exception as e:
        import traceback
        print(f"Error: {e}")
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
        print(f"\\nTotal trains found: {len(items)}")
`;
}

// ── Step Functions ───────────────────────────────────────────────────────────

async function dismissPopups(page) {
  console.log("🔲 Dismissing popups...");
  const selectors = [
    "button:has-text('Accept')",
    "button:has-text('Got it')",
    "button:has-text('OK')",
    "button:has-text('知道了')",
    "button:has-text('关闭')",
    ".close-btn",
  ];
  for (const sel of selectors) {
    try {
      const btn = page.locator(sel);
      if (await btn.isVisible({ timeout: 1500 })) {
        await btn.click();
        console.log(`   ✅ Dismissed: ${sel}`);
      }
    } catch (e) { /* not present */ }
  }
  await page.waitForTimeout(500);
}

async function extractTrains(stagehand, page, recorder) {
  console.log(`🎯 STEP 5: Extract up to ${CFG.maxResults} trains...\n`);
  const { z } = require("zod/v3");

  // First, let's check what's on the page
  const pageTitle = await page.title();
  console.log(`   📄 Page title: ${pageTitle}`);
  const pageUrl = page.url();
  console.log(`   📄 Page URL: ${pageUrl}`);

  const listings = await stagehand.extract(
    `Extract up to ${CFG.maxResults} train search results from this page. For each train, get the train number (e.g. G1234), departure time (e.g. 08:00), arrival time (e.g. 14:30), trip duration (e.g. 6小时30分 or 6h30m), and the cheapest seat price (e.g. ¥553.5 or 553.5). Only real train listings, not ads or filters.`,
    z.object({
      trains: z.array(z.object({
        trainNumber: z.string().describe("Train number, e.g. G1234 or D5678"),
        departureTime: z.string().describe("Departure time, e.g. 08:00"),
        arrivalTime: z.string().describe("Arrival time, e.g. 14:30"),
        duration: z.string().describe("Trip duration, e.g. 6小时30分"),
        price: z.string().describe("Cheapest seat price, e.g. ¥553.5"),
      })).describe(`Up to ${CFG.maxResults} trains`),
    }),
    { page }
  );

  recorder.record("extract", {
    instruction: "Extract train search results",
    description: `Extract up to ${CFG.maxResults} trains`,
    results: listings,
  });

  console.log(`📋 Found ${listings.trains.length} trains:`);
  listings.trains.forEach((t, i) => {
    console.log(`   ${i + 1}. ${t.trainNumber}  Dep: ${t.departureTime}  Arr: ${t.arrivalTime}  Duration: ${t.duration}  Price: ${t.price}`);
  });

  return listings;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Ctrip – Train Ticket Search");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🚄 ${CFG.from} → ${CFG.to}`);
  console.log(`  📅 Departure: ${CFG.departure}  (One-way, 1 adult)\n`);

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

    // ── APPROACH: Navigate directly to the search results URL ──
    // Ctrip's form uses React state management which is hard to interact with
    // via AI-driven typing. Instead, construct the search URL directly.
    const searchUrl = `https://trains.ctrip.com/webapp/train/list?ticketType=0&dStation=${encodeURIComponent(CFG.from)}&aStation=${encodeURIComponent(CFG.to)}&dDate=${CFG.departure}&rDate=&trainsNo=&from=trains_mainpage`;
    console.log(`🌐 Loading search results: ${searchUrl}`);
    recorder.goto(searchUrl);
    await page.goto(searchUrl);
    await page.waitForLoadState("domcontentloaded");
    console.log("✅ Search results loaded\n");
    recorder.wait(CFG.waits.page, "Results page load");
    await page.waitForTimeout(8000);

    await dismissPopups(page);

    // Check if we ended up on the right page
    const resultUrl = page.url();
    console.log(`   📍 URL: ${resultUrl}`);

    const listings = await extractTrains(stagehand, page, recorder);

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${listings.trains.length} trains found`);
    console.log("═══════════════════════════════════════════════════════════");
    listings.trains.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.trainNumber}  Dep: ${t.departureTime}  Arr: ${t.arrivalTime}  Duration: ${t.duration}  Price: ${t.price}`);
    });

    // Save Python + JSON
    const pyScript = genPython(CFG, recorder);
    const pyPath = path.join(__dirname, "ctrip_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python: ${pyPath}`);

    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions: ${jsonPath}`);

    return listings;

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, recorder);
      fs.writeFileSync(path.join(__dirname, "ctrip_search.py"), pyScript, "utf-8");
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
  main().then(() => { console.log("🎊 Done!"); process.exit(0); }).catch((e) => { console.error("💥", e.message); process.exit(1); });
}
module.exports = { main };
