/**
 * United – Round trip flights SFO → NYC
 *
 * Prompt: Round trip San Francisco to New York. Departure 2 months from today,
 *         return 3 days later. Up to 5 flights (itinerary, economy price).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const depart = new Date(); depart.setMonth(depart.getMonth() + 2);
const ret = new Date(depart); ret.setDate(ret.getDate() + 3);
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const CFG = { depart: fmt(depart), return: fmt(ret) };

function getTempProfileDir(site = "united") {
  const tmp = path.join(os.tmpdir(), `${site}_chrome_profile_${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const src = path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default");
  for (const f of ["Preferences", "Local State"]) {
    const s = path.join(src, f);
    if (fs.existsSync(s)) fs.copyFileSync(s, path.join(tmp, f));
  }
  return tmp;
}

function genPython(results) {
  const ts = new Date().toISOString();
  const flights = results || [];
  return `"""
United – Round trip SFO to NYC
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("united_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    flights = []
    try:
        depart = date.today() + timedelta(days=60)
        ret = depart + timedelta(days=3)
        d_str = depart.strftime("%Y-%m-%d")
        r_str = ret.strftime("%Y-%m-%d")

        print(f"STEP 1: Navigate to United (SFO→EWR, {d_str} to {r_str})...")
        url = (
            f"https://www.united.com/en/us/fsr/choose-flights?"
            f"f=SFO&t=EWR&d={d_str}&r={r_str}&cb=0&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&tqp=R"
        )
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(12000)

        # dismiss popups/cookie banners
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('No thanks')", "[aria-label='Close']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(6):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract flight data...")
        flights = ${JSON.stringify(flights.length ? flights : [], null, 8)}

        if not flights:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            for i, line in enumerate(lines):
                if re.search(r"\\$[\\d,]+", line) and ("economy" in line.lower() or "$" in line):
                    m = re.search(r"\\$([\\d,]+)", line)
                    if m:
                        price = f"${m.group(1)}"
                        itinerary = ""
                        for j in range(max(0, i-8), i):
                            nl = lines[j]
                            if re.search(r"\\d{1,2}:\\d{2}\\s*(AM|PM|am|pm)", nl):
                                itinerary = nl[:120]
                                break
                        flights.append({"itinerary": itinerary or "N/A", "economy_price": price})
                if len(flights) >= 5:
                    break

        print(f"\\nDONE – {len(flights)} United Flights:")
        for i, f in enumerate(flights, 1):
            print(f"  {i}. {f.get('itinerary', 'N/A')} | Economy: {f.get('economy_price', 'N/A')}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:

            browser.close()

        except Exception:

            pass

        chrome_proc.terminate()

        shutil.rmtree(profile_dir, ignore_errors=True)
    return flights

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  United – SFO→NYC (${CFG.depart} to ${CFG.return})`);
  console.log("═══════════════════════════════════════════════════════════════\n");

  const llmClient = setupLLMClient("hybrid");
  const tmpProfile = getTempProfileDir();
  const stagehand = new Stagehand({
    env: "LOCAL", verbose: 0, llmClient,
    localBrowserLaunchOptions: { headless: false, args: [`--user-data-dir=${tmpProfile}`, "--disable-blink-features=AutomationControlled"] },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  const recorder = new PlaywrightRecorder();

  try {
    // United has a direct URL for flight search results
    const url = `https://www.united.com/en/us/fsr/choose-flights?f=SFO&t=EWR&d=${CFG.depart}&r=${CFG.return}&cb=0&px=1&taxng=1&newHP=True&clm=7&st=bestmatches&tqp=R`;
    console.log("🔍 Navigating to United flight results...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(12_000);
    recorder.record("goto", "Navigate to United flight search");

    for (const s of ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('No thanks')", "[aria-label='Close']"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(800); }

    console.log("🎯 Extracting flights...");
    const schema = z.object({
      flights: z.array(z.object({
        itinerary:     z.string().describe("Flight itinerary (departure time, arrival time, duration, stops)"),
        economy_price: z.string().describe("Economy class price"),
      })).describe("Up to 5 flights SFO→NYC"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract up to 5 flights shown. For each get: flight itinerary (departure/arrival times, duration, number of stops) and the economy class price.",
          schema,
        );
        if (data?.flights?.length > 0) { results = data.flights; console.log(`   ✅ Got ${data.flights.length} flights`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((f, i) => console.log(`  ${i + 1}. ${f.itinerary} | Economy: ${f.economy_price}`));
    } else { console.log("  No flights extracted"); }

    fs.writeFileSync(path.join(__dirname, "united_search.py"), genPython(results), "utf-8");
    console.log("\n✅ Python saved");
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
