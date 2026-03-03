/**
 * Kayak – Flights Boston → Miami
 *
 * Prompt: Round trip flights Boston to Miami. Departure 2 months from today,
 *         return 4 days later. Top 5 cheapest (airline, itinerary, price).
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
const ret = new Date(depart); ret.setDate(ret.getDate() + 4);
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const CFG = { origin: "BOS", dest: "MIA", depart: fmt(depart), return: fmt(ret) };

function getTempProfileDir(site = "kayak") {
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
Kayak – Flights Boston to Miami
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
    profile_dir = get_temp_profile_dir("kayak_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    flights = []
    try:
        depart = date.today() + timedelta(days=60)
        ret = depart + timedelta(days=4)
        d_str = depart.strftime("%Y-%m-%d")
        r_str = ret.strftime("%Y-%m-%d")

        print(f"STEP 1: Navigate to Kayak (BOS→MIA, {d_str} to {r_str})...")
        url = f"https://www.kayak.com/flights/BOS-MIA/{d_str}/{r_str}?sort=price_a"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(10000)

        for sel in ["button:has-text('Accept')", "button:has-text('OK')", ".dCLk-close"]:
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
                if "$" in line and re.search(r"\\$\\d+", line):
                    m = re.search(r"\\$([\\d,]+)", line)
                    if m:
                        price = f"\${m.group(1)}"
                        airline = ""
                        itinerary = ""
                        for j in range(max(0, i-5), i):
                            nl = lines[j]
                            if re.search(r"AM|PM|\\d{1,2}:\\d{2}", nl):
                                itinerary = nl[:100]
                            elif len(nl) > 3 and len(nl) < 40 and not re.search(r"\\$|filter|sort", nl, re.IGNORECASE):
                                airline = nl
                        flights.append({"airline": airline or "N/A", "itinerary": itinerary or "N/A", "price": price})
                if len(flights) >= 5:
                    break

        print(f"\\nDONE – Top {len(flights)} Cheapest Flights:")
        for i, f in enumerate(flights, 1):
            print(f"  {i}. {f.get('airline', 'N/A')} | {f.get('itinerary', 'N/A')} | {f.get('price', 'N/A')}")

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
  console.log(`  Kayak – Flights BOS→MIA (${CFG.depart} to ${CFG.return})`);
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
    const url = `https://www.kayak.com/flights/BOS-MIA/${CFG.depart}/${CFG.return}?sort=price_a`;
    console.log("🔍 Navigating to Kayak flight search...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(10_000); // Kayak needs time to load results
    recorder.record("goto", "Navigate to Kayak flight search");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", ".dCLk-close", "button:has-text('OK')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(800); }

    console.log("🎯 Extracting flights...");
    const schema = z.object({
      flights: z.array(z.object({
        airline:   z.string().describe("Airline name"),
        itinerary: z.string().describe("Flight itinerary (departure/arrival times, stops)"),
        price:     z.string().describe("Total round trip price"),
      })).describe("Top 5 cheapest flights"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 cheapest flights shown on this page. For each get: airline name, flight itinerary (departure/arrival times and any stops), and total price.",
          schema,
        );
        if (data?.flights?.length > 0) { results = data.flights; console.log(`   ✅ Got ${data.flights.length} flights`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2_000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((f, i) => console.log(`  ${i + 1}. ${f.airline} | ${f.itinerary} | ${f.price}`));
    } else { console.log("  No flights extracted"); }

    fs.writeFileSync(path.join(__dirname, "kayak_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
