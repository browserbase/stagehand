/**
 * Southwest – Round trip flights Denver → LA
 *
 * Prompt: Round trip Denver to LA. Departure 2 months from today,
 *         return 5 days later. Up to 5 flights (itinerary, Wanna Get Away price).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 240_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const depart = new Date(); depart.setMonth(depart.getMonth() + 2);
const ret = new Date(depart); ret.setDate(ret.getDate() + 5);
const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const CFG = { origin: "Denver, CO (DEN)", dest: "Los Angeles, CA (LAX)", depart: fmt(depart), return: fmt(ret) };

function getTempProfileDir(site = "southwest") {
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
Southwest – Round trip Denver to Los Angeles
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback
from datetime import date, timedelta
from playwright.sync_api import Playwright, sync_playwright

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
    flights = []
    try:
        depart = date.today() + timedelta(days=60)
        ret = depart + timedelta(days=5)

        print("STEP 1: Navigate to Southwest...")
        page.goto("https://www.southwest.com/air/booking/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        # dismiss popups / cookie banners
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('No thanks')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        print("STEP 2: Fill flight search form...")
        # Select Round Trip (default)
        try:
            rt = page.locator("input[value='RT'], #type-roundtrip")
            if rt.is_visible(timeout=1000):
                rt.evaluate("el => el.click()")
        except Exception:
            pass

        # Origin
        try:
            orig_input = page.locator("#originationAirportCode, input[name='originationAirportCode']").first
            orig_input.evaluate("el => el.click()")
            orig_input.fill("DEN", timeout=2000)
            page.wait_for_timeout(1500)
            page.keyboard.press("Enter")
        except Exception:
            pass

        page.wait_for_timeout(500)

        # Destination
        try:
            dest_input = page.locator("#destinationAirportCode, input[name='destinationAirportCode']").first
            dest_input.evaluate("el => el.click()")
            dest_input.fill("LAX", timeout=2000)
            page.wait_for_timeout(1500)
            page.keyboard.press("Enter")
        except Exception:
            pass

        page.wait_for_timeout(500)

        # Dates
        d_str = depart.strftime("%m/%d/%Y")
        r_str = ret.strftime("%m/%d/%Y")
        try:
            dep_input = page.locator("#departureDate, input[name='departureDate']").first
            dep_input.evaluate("el => el.click()")
            dep_input.fill(d_str, timeout=2000)
        except Exception:
            pass
        try:
            ret_input = page.locator("#returnDate, input[name='returnDate']").first
            ret_input.evaluate("el => el.click()")
            ret_input.fill(r_str, timeout=2000)
        except Exception:
            pass

        page.wait_for_timeout(500)

        # Submit
        try:
            page.locator("#form-mixin--submit-button, button[type='submit']:has-text('Search')").first.evaluate("el => el.click()")
        except Exception:
            pass
        page.wait_for_timeout(10000)

        print("STEP 3: Extract flight data...")
        flights = ${JSON.stringify(flights.length ? flights : [], null, 8)}

        if not flights:
            for _ in range(5):
                page.evaluate("window.scrollBy(0, 600)")
                page.wait_for_timeout(600)

            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            for i, line in enumerate(lines):
                if re.search(r"\\$\\d+", line) and "wanna" not in line.lower():
                    # Look for "Wanna Get Away" price specifically
                    pass
                if "wanna get away" in line.lower() or re.search(r"\\$\\d+", line):
                    m = re.search(r"\\$([\\d,]+)", line)
                    if m:
                        price = "$" + m.group(1)
                        itinerary = ""
                        for j in range(max(0, i-6), i):
                            nl = lines[j]
                            if re.search(r"\\d{1,2}:\\d{2}\\s*(AM|PM)", nl, re.IGNORECASE):
                                itinerary = nl[:100]
                                break
                        flights.append({"itinerary": itinerary or "N/A", "wanna_get_away_price": price})
                if len(flights) >= 5:
                    break

        print(f"\\nDONE – {len(flights)} Southwest Flights:")
        for i, f in enumerate(flights, 1):
            print(f"  {i}. {f.get('itinerary', 'N/A')} | Wanna Get Away: {f.get('wanna_get_away_price', 'N/A')}")

    except Exception as e:
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        context.close()
    return flights

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Southwest – DEN→LAX (${CFG.depart} to ${CFG.return})`);
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
    console.log("🔍 Navigating to Southwest booking page...");
    await page.goto("https://www.southwest.com/air/booking/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8000);
    recorder.record("goto", "Navigate to Southwest booking");

    for (const s of ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('No thanks')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // ========================================================
    // FORM FILLING — All via page.evaluate() (browser JS)
    // Stagehand page doesn't expose keyboard API, so we
    // set input values and dispatch events via JS directly.
    // Known IDs: #originationAirportCode, #destinationAirportCode,
    //   #departureDate, #returnDate, #flightBookingSubmit
    // ========================================================
    console.log("📝 Filling search form (evaluate)...");

    // Helper: set an input value via JS and fire input/change events
    async function setInputValue(selector, value) {
      return page.evaluate(({ sel, val }) => {
        const el = document.querySelector(sel);
        if (!el) return `NOT_FOUND: ${sel}`;
        // Focus the input
        el.focus();
        el.click();
        // Use native input value setter to bypass React controlled component
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        ).set;
        nativeInputValueSetter.call(el, val);
        // Dispatch events React listens to
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'a' }));
        el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
        return `OK: ${sel} = "${val}"`;
      }, { sel: selector, val: value });
    }

    // Helper: simulate typing character by character (for autocomplete)
    async function simulateTyping(selector, text) {
      // Clear first
      await page.evaluate(({ sel }) => {
        const el = document.querySelector(sel);
        if (!el) return;
        el.focus();
        el.click();
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, '');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, { sel: selector });
      await page.waitForTimeout(300);

      // Type each character
      for (const ch of text) {
        await page.evaluate(({ sel, char }) => {
          const el = document.querySelector(sel);
          if (!el) return;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, el.value + char);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: char }));
          el.dispatchEvent(new KeyboardEvent('keypress', { bubbles: true, key: char }));
          el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: char }));
        }, { sel: selector, char: ch });
        await page.waitForTimeout(80);
      }
    }

    // Helper: select airport from autocomplete
    async function selectAirport(inputSelector, code, cityName) {
      console.log(`   📌 Setting airport ${code} in ${inputSelector}...`);

      // Clear and type the 3-letter code (more precise than city name)
      await simulateTyping(inputSelector, code);
      await page.waitForTimeout(2500); // wait for autocomplete

      // Dump dropdown DOM for debugging
      const dropdownInfo = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return { error: "input not found" };

        // Look for nearby listbox / dropdown containers
        const listboxes = document.querySelectorAll('[role="listbox"]');
        const dropdowns = [];
        for (const lb of listboxes) {
          const items = lb.querySelectorAll('[role="option"], li');
          const texts = Array.from(items).map(it => ({
            tag: it.tagName,
            role: it.getAttribute('role'),
            text: it.textContent.trim().substring(0, 80),
            ariaSel: it.getAttribute('aria-selected'),
          }));
          dropdowns.push({ id: lb.id, class: lb.className.substring(0, 60), itemCount: items.length, items: texts.slice(0, 8) });
        }

        // Also check for any visible list items near the combobox
        const allLis = document.querySelectorAll('li');
        const visibleLis = [];
        for (const li of allLis) {
          const r = li.getBoundingClientRect();
          if (r.height > 0 && r.width > 0) {
            const t = li.textContent.trim();
            if (t.length > 2 && t.length < 100) visibleLis.push(t.substring(0, 80));
          }
        }

        return { inputValue: el.value, listboxCount: listboxes.length, dropdowns, visibleLisNearby: visibleLis.slice(0, 10) };
      }, inputSelector);
      console.log(`   🔍 Dropdown: ${JSON.stringify(dropdownInfo).substring(0, 300)}`);

      // Try to click the correct option
      let selected = false;

      // Method 1: Click [role="option"] containing the code
      if (!selected) {
        selected = await page.evaluate((airportCode) => {
          const options = document.querySelectorAll('[role="option"]');
          for (const opt of options) {
            if (opt.textContent.includes(airportCode)) {
              opt.click();
              return true;
            }
          }
          return false;
        }, code);
        if (selected) console.log(`   ✅ Clicked [role="option"] with ${code}`);
      }

      // Method 2: Click any li containing the code
      if (!selected) {
        selected = await page.evaluate((airportCode) => {
          const items = document.querySelectorAll('li');
          for (const item of items) {
            const r = item.getBoundingClientRect();
            if (r.height > 0 && r.width > 0 && item.textContent.includes(airportCode)) {
              item.click();
              return true;
            }
          }
          return false;
        }, code);
        if (selected) console.log(`   ✅ Clicked li with ${code}`);
      }

      // Method 3: ArrowDown + Enter via JS keyboard events
      if (!selected) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', keyCode: 40 }));
        }, inputSelector);
        await page.waitForTimeout(300);
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) {
            el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', keyCode: 13 }));
            el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Enter', keyCode: 13 }));
          }
        }, inputSelector);
        console.log(`   ✅ ArrowDown+Enter fallback for ${code}`);
      }

      // Method 4: AI fallback
      if (!selected) {
        try {
          await stagehand.act(`Select ${cityName} (${code}) from the airport dropdown`);
          console.log(`   ✅ AI selected ${code}`);
        } catch (e) { console.log(`   ⚠ AI fallback failed: ${e.message}`); }
      }

      await page.waitForTimeout(1500);

      // Verify
      const val = await page.evaluate((sel) => document.querySelector(sel)?.value, inputSelector);
      console.log(`   📋 ${inputSelector} value after select: "${val}"`);
      return val;
    }

    // Step 1: Origin airport
    const originVal = await selectAirport("#originationAirportCode", "DEN", "Denver, CO");
    recorder.record("fill", "Set origin to DEN");

    // Step 2: Destination airport
    const destVal = await selectAirport("#destinationAirportCode", "LAX", "Los Angeles, CA");
    recorder.record("fill", "Set destination to LAX");

    // Step 3 & 4: Dates via stagehand.act() — these masked inputs need real
    // browser keystrokes that trigger React state updates, not just DOM value changes.
    const depMM = String(depart.getMonth() + 1).padStart(2, "0");
    const depDD = String(depart.getDate()).padStart(2, "0");
    const depStr = `${depMM}/${depDD}`;
    const retMM = String(ret.getMonth() + 1).padStart(2, "0");
    const retDD = String(ret.getDate()).padStart(2, "0");
    const retStr = `${retMM}/${retDD}`;

    // Departure date
    console.log(`   📌 Setting departure date: ${depStr}...`);
    try {
      await stagehand.act(`Click the Depart Date field and type ${depStr}`);
      console.log("   ✅ AI set departure date");
    } catch (e) {
      console.log(`   ⚠ AI departure failed: ${e.message}, trying evaluate...`);
      await simulateTyping("#departureDate", depStr);
    }
    await page.waitForTimeout(1000);
    // Close any calendar popup by clicking elsewhere
    try { await page.locator("body").click({ position: { x: 10, y: 10 } }); } catch {}
    await page.waitForTimeout(500);
    let depVal = await page.evaluate(() => document.querySelector('#departureDate')?.value);
    console.log(`   📋 departure value: "${depVal}"`);
    recorder.record("fill", `Set departure date to ${depStr}`);

    // Return date
    console.log(`   📌 Setting return date: ${retStr}...`);
    try {
      await stagehand.act(`Click the Return Date field and type ${retStr}`);
      console.log("   ✅ AI set return date");
    } catch (e) {
      console.log(`   ⚠ AI return failed: ${e.message}, trying evaluate...`);
      await simulateTyping("#returnDate", retStr);
    }
    await page.waitForTimeout(1000);
    try { await page.locator("body").click({ position: { x: 10, y: 10 } }); } catch {}
    await page.waitForTimeout(500);
    let retVal = await page.evaluate(() => document.querySelector('#returnDate')?.value);
    console.log(`   📋 return value: "${retVal}"`);
    recorder.record("fill", `Set return date to ${retStr}`);

    // Log current form state before submit
    const formState = await page.evaluate(() => {
      const orig = document.querySelector('#originationAirportCode');
      const dest = document.querySelector('#destinationAirportCode');
      const dep = document.querySelector('#departureDate');
      const ret = document.querySelector('#returnDate');
      return {
        origin: orig?.value || 'N/A',
        dest: dest?.value || 'N/A',
        depart: dep?.value || 'N/A',
        return: ret?.value || 'N/A',
      };
    });
    console.log(`   📋 Form state before submit: origin="${formState.origin}", dest="${formState.dest}", depart="${formState.depart}", return="${formState.return}"`);

    // Step 5: Click Search (#flightBookingSubmit)
    console.log("   🔍 Clicking Search flights button...");
    let searchClicked = false;
    try {
      const btn = page.locator("#flightBookingSubmit").first();
      if (await btn.isVisible({ timeout: 3000 })) {
        await btn.click({ timeout: 5000 });
        console.log("   ✅ Clicked #flightBookingSubmit");
        searchClicked = true;
      }
    } catch (e) { console.log(`   ⚠ #flightBookingSubmit: ${e.message}`); }

    if (!searchClicked) {
      try {
        const btn = page.locator("button[type='submit']").first();
        if (await btn.isVisible({ timeout: 2000 })) {
          await btn.click({ timeout: 3000 });
          console.log("   ✅ Clicked button[type=submit]");
          searchClicked = true;
        }
      } catch (e) { console.log(`   ⚠ submit btn: ${e.message}`); }
    }

    if (!searchClicked) {
      console.log("   🤖 AI fallback...");
      try { await stagehand.act("Click the Search button"); searchClicked = true; } catch {}
    }
    recorder.record("click", "Click Search flights button");

    // Wait for navigation
    console.log("   ⏳ Waiting for flight results...");
    let navigated = false;
    try {
      await page.waitForURL(/\/air\/booking\/select[-.]/, { timeout: 30_000 });
      console.log("   ✅ Navigated to results page!");
      navigated = true;
    } catch {
      console.log("   ⚠ URL didn't change to /select after locator click");

      // Try submitting form via JavaScript as backup
      console.log("   🔄 Trying JS form submit...");
      try {
        await page.evaluate(() => {
          const btn = document.querySelector('#flightBookingSubmit');
          if (btn) btn.click();
        });
        console.log("   ✅ JS click on submit");
      } catch (e) { console.log(`   ⚠ JS click failed: ${e.message}`); }

      // Wait again after JS submit
      try {
        await page.waitForURL(/\/air\/booking\/select[-.]/, { timeout: 20_000 });
        console.log("   ✅ Navigated after JS submit!");
        navigated = true;
      } catch {
        console.log("   ⚠ Still no navigation after JS submit");
      }
    }

    // If still no navigation, check for errors/obstacles
    if (!navigated) {
      try {
        const pageStatus = await page.evaluate(() => {
          const errors = document.querySelectorAll('[class*="error"], [class*="Error"], [role="alert"], .field-error, .form-error');
          const errorTexts = [];
          for (const e of errors) {
            const t = e.textContent.trim();
            if (t && t.length < 200) errorTexts.push(t);
          }
          const spinners = document.querySelectorAll('[class*="spinner"], [class*="loading"], [class*="Spinner"]');
          const bodyText = document.body.innerText.substring(0, 500);
          return { errors: errorTexts, hasSpinner: spinners.length > 0, bodySnippet: bodyText };
        });
        console.log(`   📋 Errors: ${JSON.stringify(pageStatus.errors)}`);
        console.log(`   📋 Has spinner: ${pageStatus.hasSpinner}`);
        console.log(`   📋 Body snippet: ${pageStatus.bodySnippet.substring(0, 300)}`);
      } catch (e) { console.log(`   ⚠ Diagnostic failed: ${e.message}`); }

      // Last resort: use AI to click Search
      console.log("   🤖 AI fallback: clicking Search...");
      try {
        await stagehand.act("Click the Search button to search for flights");
        await page.waitForTimeout(15_000);
      } catch (e) { console.log(`   ⚠ AI click failed: ${e.message}`); }
    }
    const currentUrl = page.url();
    console.log(`   📍 Current URL: ${currentUrl}`);

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting flights...");
    const schema = z.object({
      flights: z.array(z.object({
        flight_number:        z.string().describe("Southwest flight number, e.g. 'WN 2133'"),
        itinerary:            z.string().describe("Flight itinerary (departure/arrival times, stops)"),
        wanna_get_away_price: z.string().describe('Price for "Wanna Get Away" fare'),
      })).describe("Up to 5 flights DEN→LAX"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          'Extract up to 5 flights shown. For each get: the flight number (shown as # followed by digits, prefix with "WN "), flight itinerary (departure time, arrival time, stops), and the "Wanna Get Away" fare price.',
          schema,
        );
        if (data?.flights?.length > 0) { results = data.flights; console.log(`   ✅ Got ${data.flights.length} flights`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((f, i) => console.log(`  ${i + 1}. ${f.flight_number} ${f.itinerary} | WGA: ${f.wanna_get_away_price}`));
    } else { console.log("  No flights extracted"); }

    // Python file is maintained separately — don't overwrite it
    // fs.writeFileSync(path.join(__dirname, "southwest_search.py"), genPython(results), "utf-8");
    console.log("\n✅ Done (Python file not overwritten)");
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
