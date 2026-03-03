/**
 * Expedia – Hotels in San Diego
 *
 * Prompt: Search hotels in San Diego, CA. Check-in 2 months from today,
 *         check-out 3 nights later. Filter "Guest rating 4.0+".
 *         Top 5 hotels (name, per-night price).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

// Calculate dates: 2 months from now, 3 nights stay
const checkin = new Date(); checkin.setMonth(checkin.getMonth() + 2);
const checkout = new Date(checkin); checkout.setDate(checkout.getDate() + 3);
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const CFG = { dest: "San Diego, CA", checkin: fmt(checkin), checkout: fmt(checkout) };

function getTempProfileDir(site = "expedia") {
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
  const hotels = results || [];
  return `"""
Expedia – Hotels in San Diego
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

DEST = "${CFG.dest}"

def run(playwright: Playwright) -> list:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default",
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir, channel="chrome", headless=False,
        viewport={"width": 1280, "height": 900},
        args=["--disable-blink-features=AutomationControlled",
              "--disable-infobars", "--disable-extensions"],
    )
    page = context.pages[0] if context.pages else context.new_page()
    hotels = []
    try:
        # Calculate dates
        checkin = date.today() + timedelta(days=60)
        checkout = checkin + timedelta(days=3)
        ci_str = checkin.strftime("%Y-%m-%d")
        co_str = checkout.strftime("%Y-%m-%d")

        print(f"STEP 1: Navigate to Expedia (San Diego, {ci_str} to {co_str})...")
        url = f"https://www.expedia.com/Hotel-Search?destination=San+Diego%2C+CA&startDate={ci_str}&endDate={co_str}&adults=2&sort=RECOMMENDED"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(6000)

        # Dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Close')", "button:has-text('No Thanks')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        # Scroll
        for _ in range(6):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract hotel data...")
        body = page.locator("body").inner_text(timeout=10000)

        hotels = ${JSON.stringify(hotels.length ? hotels : [], null, 8)}

        if not hotels:
            # Parse from body text
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            for i, line in enumerate(lines):
                if re.search(r"hotel|inn|resort|suites|lodge|hilton|marriott|hyatt", line, re.IGNORECASE) and 5 < len(line) < 80:
                    price = "N/A"
                    for j in range(i, min(i+8, len(lines))):
                        m = re.search(r"\\$(\\d+)", lines[j])
                        if m:
                            price = "$" + m.group(1)
                            break
                    hotels.append({"name": line, "price_per_night": price})
                if len(hotels) >= 5:
                    break

        print(f"\\nDONE – Top {len(hotels)} Hotels:")
        for i, h in enumerate(hotels, 1):
            print(f"  {i}. {h.get('name', 'N/A')} | {h.get('price_per_night', 'N/A')}/night")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        context.close()
    return hotels

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Expedia – Hotels in San Diego (${CFG.checkin} to ${CFG.checkout})`);
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
    const url = `https://www.expedia.com/Hotel-Search?destination=San+Diego%2C+CA&startDate=${CFG.checkin}&endDate=${CFG.checkout}&adults=2&sort=RECOMMENDED`;
    console.log("🔍 Navigating to Expedia hotel search...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(6_000);
    recorder.record("goto", "Navigate to Expedia hotel search");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "button:has-text('Close')", "button:has-text('No Thanks')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Try to apply guest rating filter
    console.log("🔧 Applying guest rating 4.0+ filter...");
    try {
      await stagehand.act("click on the guest rating filter or find the filter for guest rating");
      await page.waitForTimeout(1500);
      await stagehand.act("select 'Good 4.0+' or '4.0+' rating filter");
      await page.waitForTimeout(3000);
      recorder.record("act", "Filter by guest rating 4.0+");
    } catch (e) { console.log(`   ⚠ Filter: ${e.message}`); }

    for (let i = 0; i < 6; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(700); }

    console.log("🎯 Extracting hotels...");
    const schema = z.object({
      hotels: z.array(z.object({
        name:            z.string().describe("Hotel name"),
        price_per_night: z.string().describe("Price per night"),
      })).describe("Top 5 hotels"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 hotels shown on this page. For each get: hotel name and price per night.",
          schema,
        );
        if (data?.hotels?.length > 0) { results = data.hotels; console.log(`   ✅ Got ${data.hotels.length} hotels`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((h, i) => console.log(`  ${i + 1}. ${h.name} | ${h.price_per_night}/night`));
    } else { console.log("  No hotels extracted"); }

    // genPython disabled — expedia_search.py is hand-maintained
    // fs.writeFileSync(path.join(__dirname, "expedia_search.py"), genPython(results), "utf-8");
    // console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
