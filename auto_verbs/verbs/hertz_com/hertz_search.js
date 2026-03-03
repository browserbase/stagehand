/**
 * Hertz – Car Rental at LAX
 *
 * Prompt: Search car rental at LAX. Pick-up 2 months from today,
 *         drop-off 5 days later. Up to 5 cars (name/class, daily price).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 300_000;
const _timer = setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const pickup = new Date(); pickup.setMonth(pickup.getMonth() + 2);
const dropoff = new Date(pickup); dropoff.setDate(dropoff.getDate() + 5);
const fmtDate = d => `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
// Hertz URL date format: MM/DD/YYYY and time as HH:MM
const fmtDateURL = d => `${String(d.getMonth()+1).padStart(2,'0')}%2F${String(d.getDate()).padStart(2,'0')}%2F${d.getFullYear()}`;
const CFG = {
  pickup: fmtDate(pickup),
  dropoff: fmtDate(dropoff),
  pickupURL: fmtDateURL(pickup),
  dropoffURL: fmtDateURL(dropoff),
};

function getTempProfileDir(site = "hertz") {
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
  const cars = results || [];
  return `"""
Hertz – Car Rental at LAX
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
    profile_dir = get_temp_profile_dir("hertz_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    cars = []
    try:
        pickup = date.today() + timedelta(days=60)
        dropoff = pickup + timedelta(days=5)

        # Aria-label patterns for DayPicker cells (e.g. "Apr 28 2026")
        pu_month = pickup.strftime("%b")
        pu_day = pickup.day
        pu_year = pickup.year
        do_month = dropoff.strftime("%b")
        do_day = dropoff.day
        do_year = dropoff.year
        pu_aria = f"{pu_month} {pu_day} {pu_year}"
        pu_aria_pad = f"{pu_month} {pu_day:02d} {pu_year}"
        do_aria = f"{do_month} {do_day} {do_year}"
        do_aria_pad = f"{do_month} {do_day:02d} {do_year}"

        print(f"STEP 1: Navigate to Hertz reservation (LAX, pickup {pu_aria}, return {do_aria})...")
        page.goto("https://www.hertz.com/rentacar/reservation/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # Dismiss popups/cookie banners
        for sel in ["#onetrust-accept-btn-handler", "button:has-text('Accept')", "button:has-text('Close')"]:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=500):
                    el.evaluate("el => el.click()")
            except Exception:
                pass
        page.wait_for_timeout(500)

        # --- Helpers for react-day-picker calendar ---
        def is_calendar_open():
            return page.evaluate("(() => { const dp = document.querySelector('.DayPicker'); return dp ? dp.offsetParent !== null : false; })()")

        def ensure_calendar_open(trigger_id, max_attempts=3):
            for _ in range(max_attempts):
                if is_calendar_open():
                    return True
                page.locator(trigger_id).evaluate("el => el.click()")
                page.wait_for_timeout(2000)
            return is_calendar_open()

        def find_day_cell(pattern, padded):
            cell = page.locator(f"div.DayPicker-Day[aria-label*='{pattern}']")
            if cell.count() > 0:
                return cell.first
            cell = page.locator(f"div.DayPicker-Day[aria-label*='{padded}']")
            if cell.count() > 0:
                return cell.first
            return None

        def click_next_month():
            btn = page.locator("[aria-label='Next Month']")
            if btn.count() > 0:
                btn.first.evaluate("el => el.click()")
                page.wait_for_timeout(600)
                return True
            return False

        # --- Fill location (concretized: #locationInput + li[role='option']) ---
        print("STEP 2: Setting pickup location to LAX...")
        page.locator("#locationInput").evaluate("el => el.click()")
        page.locator("#locationInput").fill("LAX")
        page.wait_for_timeout(2500)
        if page.locator("li[role='option']").count() > 0:
            page.locator("li[role='option']").first.evaluate("el => el.click()")
        page.wait_for_timeout(1500)

        # --- Pickup date (concretized: DayPicker cell click with force) ---
        print(f"STEP 3: Setting pickup date ({pu_aria})...")
        pu_found = False
        ensure_calendar_open("#dateTimePickerTriggerFrom")
        for _ in range(12):
            cell = find_day_cell(pu_aria, pu_aria_pad)
            if cell:
                cell.evaluate("el => el.click()")
                page.wait_for_timeout(800)
                pu_found = True
                break
            if not click_next_month():
                break
        print(f"  Pickup date {'set' if pu_found else 'NOT found'}")
        page.wait_for_timeout(1000)

        # --- Return date (range-picker stays open after pickup; 3 strategies) ---
        print(f"STEP 4: Setting return date ({do_aria})...")
        do_found = False
        page.wait_for_timeout(800)
        cell = find_day_cell(do_aria, do_aria_pad)
        if cell:
            cell.evaluate("el => el.click()")
            page.wait_for_timeout(800)
            do_found = True
        if not do_found and is_calendar_open():
            for _ in range(6):
                cell = find_day_cell(do_aria, do_aria_pad)
                if cell:
                    cell.evaluate("el => el.click()")
                    page.wait_for_timeout(800)
                    do_found = True
                    break
                if not click_next_month():
                    break
        if not do_found:
            ensure_calendar_open("#dateTimePickerTriggerTo")
            for _ in range(6):
                cell = find_day_cell(do_aria, do_aria_pad)
                if cell:
                    cell.evaluate("el => el.click()")
                    page.wait_for_timeout(800)
                    do_found = True
                    break
                if not click_next_month():
                    break
        print(f"  Return date {'set' if do_found else 'NOT found'}")
        page.wait_for_timeout(500)

        # --- Close calendar (Escape + header — DO NOT click #locationInput!) ---
        page.evaluate("(() => { document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',code:'Escape',bubbles:true})); document.activeElement?.blur(); })()")
        page.wait_for_timeout(1000)
        if is_calendar_open():
            try:
                page.locator("header").first.evaluate("el => el.click()")
            except Exception:
                pass
            page.wait_for_timeout(1000)

        # --- Submit search (DOM click — bypasses viewport/overlay issues) ---
        print("STEP 5: Submitting search...")
        page.evaluate("(() => { const b = document.querySelector(\"button[type='submit']\"); if (b) b.click(); })()")
        page.wait_for_timeout(12000)
        print(f"  Final URL: {page.url}")

        # If still on homepage, navigate directly to vehicle page
        if "/book/vehicles" not in page.url and "/reservation/vehicle" not in page.url:
            pu_iso = pickup.strftime("%Y-%m-%d")
            do_iso = dropoff.strftime("%Y-%m-%d")
            vehicle_url = (
                f"https://www.hertz.com/us/en/book/vehicles?"
                f"pid=LAXT15&did=LAXT15"
                f"&pdate={pu_iso}T12%3A00%3A00&ddate={do_iso}T12%3A00%3A00"
            )
            print(f"  Navigating directly to: {vehicle_url}")
            page.goto(vehicle_url, wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(10000)
            print(f"  Final URL: {page.url}")

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 6: Extract car listings...")

        # --- Strategy 1: structured selectors ---
        CAR_CARD_SELS = [
            ".vehicle-card", ".car-class-card", "[data-testid*='vehicle']",
            ".vehicle-matrix-cell", ".available-car", ".vehicle-select",
            ".car-card", "[class*='VehicleCard']", "[class*='vehicle-card']",
        ]
        for sel in CAR_CARD_SELS:
            try:
                cards = page.locator(sel)
                count = cards.count()
                if count == 0:
                    continue
                print(f"  Found {count} cards via '{sel}'")
                for idx in range(min(count, 5)):
                    txt = cards.nth(idx).inner_text(timeout=3000).strip()
                    if not txt or len(txt) < 5:
                        continue
                    lines = [l.strip() for l in txt.split("\\n") if l.strip()]
                    car_name = lines[0] if lines else "N/A"
                    price = "N/A"
                    for ln in lines:
                        m = re.search(r"\\$(\\d+[\\.,]?\\d*)", ln)
                        if m:
                            price = "$" + m.group(1) + "/day"
                            break
                    if car_name and car_name != "N/A":
                        cars.append({"car_name": car_name, "daily_price": price})
                if cars:
                    break
            except Exception:
                pass

        # --- Strategy 2: body text scan for car classes ---
        if not cars:
            print("  Falling back to body text scan...")
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            CLASS_RE = re.compile(r"economy|compact|midsize|mid-size|full[- ]?size|suv|premium|luxury|standard|intermediate|convertible|minivan|pickup", re.IGNORECASE)
            SKIP_RE = re.compile(r"^(most popular|good deal|best value|great choice|limited|offer|save|\\d+% off)", re.IGNORECASE)
            for i, line in enumerate(lines):
                if SKIP_RE.search(line):
                    continue
                # line matches a car class OR looks like a car model (e.g. 'Toyota Corolla or similar')
                if (CLASS_RE.search(line) or re.search(r"or similar", line, re.IGNORECASE)) and 3 < len(line) < 100:
                    price = "N/A"
                    for j in range(max(i-2, 0), min(i+6, len(lines))):
                        m = re.search(r"\\$(\\d+[\\.,]?\\d*)", lines[j])
                        if m:
                            price = "$" + m.group(1) + "/day"
                            break
                    cars.append({"car_name": line, "daily_price": price})
                if len(cars) >= 5:
                    break

        print(f"\\nDONE – Available Cars ({len(cars)}):")
        for i, c in enumerate(cars, 1):
            print(f"  {i}. {c.get('car_name', 'N/A')} | {c.get('daily_price', 'N/A')}")

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
    return cars

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Hertz – Car Rental at LAX (${CFG.pickup} to ${CFG.dropoff})`);
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
    console.log("🔍 Navigating to Hertz...");
    await page.goto("https://www.hertz.com/rentacar/reservation/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to Hertz reservation");

    // Dismiss popups/cookie banners (proven selectors)
    for (const s of ["#onetrust-accept-btn-handler", "button:has-text('Accept')", "button:has-text('Close')", ".cc-btn.cc-dismiss"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }
    await page.waitForTimeout(500);
    console.log(`📋 Landed on: ${page.url()}`);

    // ─── Helpers (concretized from proven selectors) ───
    const isCalendarOpen = () => page.evaluate(() => {
      const dp = document.querySelector('.DayPicker');
      return dp ? dp.offsetParent !== null : false;
    });

    const ensureCalendarOpen = async (triggerId) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        if (await isCalendarOpen()) return true;
        await page.locator(triggerId).click({ timeout: 3000 });
        await page.waitForTimeout(2_000);
      }
      return isCalendarOpen();
    };

    // Try non-padded then padded day (e.g. "May 3 2026" vs "May 03 2026")
    const findDayCell = async (pattern, padded) => {
      let cell = page.locator(`div.DayPicker-Day[aria-label*='${pattern}']`);
      if (await cell.count() > 0) return cell.first();
      cell = page.locator(`div.DayPicker-Day[aria-label*='${padded}']`);
      if (await cell.count() > 0) return cell.first();
      return null;
    };

    // Proven selector: BUTTON[aria-label='Next Month'] (emotion-cache class)
    const clickNextMonth = async () => {
      const btn = page.locator("[aria-label='Next Month']");
      if (await btn.count() > 0) { await btn.first().click({ timeout: 1000 }); await page.waitForTimeout(600); return true; }
      return false;
    };

    // ═══ Step 1: Fill location (concretized: #locationInput + li[role='option'] MuiAutocomplete) ═══
    console.log("\n📍 Setting pickup location...");
    try {
      await page.locator("#locationInput").click({ timeout: 3000 });
      await page.locator("#locationInput").fill("LAX");
      await page.waitForTimeout(2_500);
      // Proven: li[role='option'].MuiAutocomplete-option — first is the LAX airport
      const suggestion = page.locator("li[role='option']").first();
      if (await suggestion.count() > 0) {
        const sugTxt = await suggestion.textContent();
        console.log(`   Selecting: "${sugTxt?.trim()?.substring(0, 60)}"`);
        await suggestion.click({ timeout: 3000 });
      } else {
        console.log("   No suggestion found, using AI...");
        await stagehand.act("select 'Los Angeles International Airport (LAX)' from the dropdown suggestions");
      }
      await page.waitForTimeout(1_500);
      recorder.record("act", "Set LAX as pickup");
    } catch (e) { console.log(`   ⚠ Location: ${e.message}`); }

    // ═══ Step 2: Fill dates (concretized: DayPicker proven selectors) ═══
    const puMonthShort = pickup.toLocaleString('en-US', { month: 'short' });
    const puDay = pickup.getDate();
    const puYear = pickup.getFullYear();
    const doMonthShort = dropoff.toLocaleString('en-US', { month: 'short' });
    const doDay = dropoff.getDate();
    const doYear = dropoff.getFullYear();

    const puAriaPattern = `${puMonthShort} ${puDay} ${puYear}`;
    const puAriaPadded = `${puMonthShort} ${String(puDay).padStart(2, '0')} ${puYear}`;
    const doAriaPattern = `${doMonthShort} ${doDay} ${doYear}`;
    const doAriaPadded = `${doMonthShort} ${String(doDay).padStart(2, '0')} ${doYear}`;

    // --- Pickup date ---
    console.log(`\n📅 Setting pickup date: ${puAriaPattern}...`);
    let puFound = false;
    try {
      const calOk = await ensureCalendarOpen("#dateTimePickerTriggerFrom");
      console.log(`   Calendar open: ${calOk}`);
      for (let i = 0; i < 12; i++) {
        const cell = await findDayCell(puAriaPattern, puAriaPadded);
        if (cell) {
          console.log(`   Found pickup day cell, clicking...`);
          await cell.click({ force: true, timeout: 2000 });
          await page.waitForTimeout(800);
          puFound = true;
          break;
        }
        if (!await clickNextMonth()) { console.log("   No next month button"); break; }
      }
    } catch (e) { console.log(`   ⚠ ${e.message}`); }
    console.log(`   Pickup date ${puFound ? '✅ set' : '❌ not found'}`);
    await page.waitForTimeout(1_000);
    recorder.record("act", "Set pickup date");

    // --- Return date ---
    // After clicking pickup date, the DayPicker likely stays open in "select return date" mode.
    // Do NOT re-click #dateTimePickerTriggerTo — that might toggle/reset the calendar.
    // Instead, look for the return cell directly.
    console.log(`📅 Setting return date: ${doAriaPattern}...`);
    let doFound = false;
    try {
      // 1) Check if return cell is already visible (range-picker: calendar auto-stays open)
      await page.waitForTimeout(800);
      let cell = await findDayCell(doAriaPattern, doAriaPadded);
      if (cell) {
        console.log(`   Return cell visible, clicking...`);
        await cell.click({ force: true, timeout: 2000 });
        await page.waitForTimeout(800);
        doFound = true;
      }

      // 2) If not visible, navigate forward (still in open calendar)
      if (!doFound && await isCalendarOpen()) {
        console.log("   Navigating forward...");
        for (let i = 0; i < 6; i++) {
          cell = await findDayCell(doAriaPattern, doAriaPadded);
          if (cell) {
            console.log(`   Found return cell, clicking...`);
            await cell.click({ force: true, timeout: 2000 });
            await page.waitForTimeout(800);
            doFound = true;
            break;
          }
          if (!await clickNextMonth()) break;
        }
      }

      // 3) Calendar was closed — open via return trigger
      if (!doFound) {
        console.log("   Opening return date calendar...");
        const calOk = await ensureCalendarOpen("#dateTimePickerTriggerTo");
        console.log(`   Calendar open: ${calOk}`);
        for (let i = 0; i < 6; i++) {
          cell = await findDayCell(doAriaPattern, doAriaPadded);
          if (cell) {
            console.log(`   Found return cell, clicking...`);
            await cell.click({ force: true, timeout: 2000 });
            await page.waitForTimeout(800);
            doFound = true;
            break;
          }
          if (!await clickNextMonth()) break;
        }
      }
    } catch (e) { console.log(`   ⚠ ${e.message}`); }
    console.log(`   Return date ${doFound ? '✅ set' : '❌ not found'}`);
    await page.waitForTimeout(500);
    recorder.record("act", "Set return date");

    // ═══ Close date picker (DO NOT click #locationInput — it resets form state!) ═══
    console.log("\n📋 Closing date picker...");
    // Try pressing Escape on the document to close the DayPicker overlay
    await page.evaluate(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      document.activeElement?.blur();
    });
    await page.waitForTimeout(1_000);
    if (await isCalendarOpen()) {
      // Click a neutral area outside the form (page header)
      console.log("   Still open, clicking page header...");
      await page.locator("header").first().click({ position: { x: 50, y: 10 }, force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1_000);
    }
    if (await isCalendarOpen()) {
      // Last resort — click body far above the form
      await page.locator("body").click({ position: { x: 200, y: 5 }, force: true, timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(1_000);
    }
    console.log(`   Calendar ${await isCalendarOpen() ? 'still open ⚠' : 'closed ✅'}`);

    // ═══ Step 3: Verify form values ═══
    console.log("\n📊 Verifying form...");
    const formCheck = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll("input")];
      return inputs.map(el => ({ id: el.id, value: el.value })).filter(x => x.value);
    });
    console.log(`   Filled inputs: ${JSON.stringify(formCheck)}`);

    // ═══ Step 4: Submit search (DOM click — bypasses viewport/overlay issues) ═══
    console.log("\n🔎 Submitting search...");
    await page.evaluate(() => {
      const btn = document.querySelector("button[type='submit']");
      if (btn) btn.click();
    });
    await page.waitForTimeout(12_000);
    recorder.record("act", "Submit search");

    console.log(`📋 After search: ${page.url()}`);
    console.log(`   Title: ${await page.title()}`);

    // If still on homepage, try AI submit as fallback
    if (page.url().includes("hertz.com/us/en?") || page.url().endsWith("/us/en")) {
      console.log("   ⚠ Still on homepage, trying AI submit...");
      try {
        await stagehand.act("click the Continue or Search or View vehicles button at the bottom of the reservation form");
        await page.waitForTimeout(10_000);
        console.log(`   After AI submit: ${page.url()}`);
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
    }

    // Last resort: navigate directly to vehicle page with constructed URL
    if (page.url().includes("hertz.com/us/en?") || page.url().endsWith("/us/en") || !page.url().includes("/book/vehicles")) {
      const puISO = `${pickup.getFullYear()}-${String(pickup.getMonth()+1).padStart(2,'0')}-${String(pickup.getDate()).padStart(2,'0')}`;
      const doISO = `${dropoff.getFullYear()}-${String(dropoff.getMonth()+1).padStart(2,'0')}-${String(dropoff.getDate()).padStart(2,'0')}`;
      const vehicleUrl = `https://www.hertz.com/us/en/book/vehicles?pid=LAXT15&did=LAXT15&pdate=${puISO}T12%3A00%3A00&ddate=${doISO}T12%3A00%3A00`;
      console.log(`   ⚠ Navigating directly to: ${vehicleUrl}`);
      await page.goto(vehicleUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(10_000);
      console.log(`   After direct nav: ${page.url()}`);
    }

    // Scroll to load car listings
    for (let i = 0; i < 8; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    // Wait for vehicle content to load
    for (let w = 0; w < 5; w++) {
      const bodySnippet = await page.evaluate(() => document.body?.innerText?.substring(0, 2000) || "");
      if (/\$\d+|per day|vehicle|select/i.test(bodySnippet)) break;
      await page.waitForTimeout(3000);
      await page.evaluate(() => window.scrollBy(0, 300));
    }

    console.log("🎯 Extracting car listings...");
    const schema = z.object({
      cars: z.array(z.object({
        car_name:    z.string().describe("Actual vehicle model name and car class, e.g. 'Nissan Versa or similar - Compact' or 'Toyota Corolla or similar - Midsize'. MUST be a real car model or class name like Economy, Compact, Midsize, Full-size, SUV, etc. Do NOT include promotional labels or badges."),
        daily_price: z.string().describe("Daily rental price as shown, e.g. '$71.00'"),
      })).describe("Up to 5 distinct available rental cars"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract up to 5 available rental cars shown on this page. " +
          "For each car, get the actual vehicle name/model and class (e.g. 'Nissan Pathfinder or similar - Standard SUV'). " +
          "IMPORTANT: Ignore promotional badges and labels like 'GOOD DEAL', 'MOST POPULAR', 'BEST VALUE', 'GREAT CHOICE' — these are NOT car names. " +
          "Only extract real car model names or rental class names (Economy, Compact, Midsize, Full-size, SUV, Premium, Luxury, etc).",
          schema,
        );
        if (data?.cars?.length > 0) { results = data.cars; console.log(`   ✅ Got ${data.cars.length} cars`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1_500);
    }

    // Post-process: filter out badge labels that the AI may have picked up as car names
    const BADGE_LABELS = /^(good deal|most popular|best value|great choice|limited|special offer|save|\d+% off|recommended|top pick|exclusive)/i;
    if (results) {
      results = results.filter(c => {
        const name = (c.car_name || "").trim();
        if (!name || name.length < 3) return false;
        if (BADGE_LABELS.test(name)) { console.log(`   🚫 Filtered badge: "${name}"`); return false; }
        return true;
      });
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results?.length) {
      results.forEach((c, i) => console.log(`  ${i + 1}. ${c.car_name} | ${c.daily_price}`));
    } else { console.log("  No cars extracted"); }

    fs.writeFileSync(path.join(__dirname, "hertz_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    clearTimeout(_timer);
    console.log("🎊 Done!");
  }
})();
