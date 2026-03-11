/**
 * Ticketmaster – Concerts in Los Angeles
 *
 * Prompt: Search "concerts" in LA, filter "This Weekend",
 *         top 5 events (name, venue, date/time, starting price).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
const watchdog = setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "ticketmaster") {
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
  const events = results || [];
  return `"""
Ticketmaster – Concerts in Los Angeles
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("ticketmaster_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    events = []
    try:
        print("STEP 1: Navigate to Ticketmaster concert search...")
        page.goto("https://www.ticketmaster.com/search?q=concerts&loc=Los+Angeles%2C+CA&daterange=thisweekend",
                   wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        for sel in ["button:has-text('Accept')", "button:has-text('Got It')", "#onetrust-accept-btn-handler"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 600)")
            page.wait_for_timeout(800)

        print("STEP 2: Extract event data...")
        body = page.locator("body").inner_text(timeout=10000)

        events = ${JSON.stringify(events.length ? events : [], null, 8)}

        if not events:
            # Try to parse from body
            lines = body.split("\\n")
            current_event = {}
            for line in lines:
                line = line.strip()
                if not line:
                    if current_event.get("name"):
                        events.append(current_event)
                        current_event = {}
                    continue
                if "$" in line and not current_event.get("price"):
                    m = re.search(r"\\$[\\d,]+", line)
                    if m:
                        current_event["price"] = m.group(0)
                elif re.search(r"\\d{1,2}/\\d{1,2}/\\d{2,4}|\\w+ \\d{1,2},", line) and not current_event.get("datetime"):
                    current_event["datetime"] = line[:60]
                elif len(line) > 5 and len(line) < 100 and not current_event.get("name"):
                    current_event["name"] = line
                if len(events) >= 5:
                    break

        print(f"\\nDONE – Top {len(events)} Events:")
        for i, e in enumerate(events, 1):
            print(f"  {i}. {e.get('name', 'N/A')}")
            print(f"     Venue: {e.get('venue', 'N/A')} | {e.get('datetime', 'N/A')} | {e.get('price', 'N/A')}")

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
    return events

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Ticketmaster – Concerts in Los Angeles");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const llmClient = setupLLMClient("copilot");
  const tmpProfile = getTempProfileDir();
  const stagehand = new Stagehand({
    env: "LOCAL", verbose: 0, llmClient,
    localBrowserLaunchOptions: { headless: false, args: [`--user-data-dir=${tmpProfile}`, "--disable-blink-features=AutomationControlled"] },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  const recorder = new PlaywrightRecorder();

  try {
    console.log("🔍 Navigating to Ticketmaster...");
    await page.goto("https://www.ticketmaster.com/search?q=concerts&loc=Los+Angeles%2C+CA&daterange=thisweekend", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);
    recorder.record("goto", "Search concerts in LA");

    // Dismiss popups
    for (const s of ["button:has-text('Accept')", "button:has-text('Got It')", "#onetrust-accept-btn-handler"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Use direct URL filter rather than UI actions to avoid flaky action schema issues.
    console.log("🔧 Filtering by This Weekend via query params...");
    await page.waitForTimeout(2000);

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting events...");
    const schema = z.object({
      events: z.array(z.object({
        name:     z.string().describe("Event/concert name"),
        venue:    z.string().describe("Venue name"),
        datetime: z.string().describe("Date and time of event"),
        price:    z.string().describe("Starting price"),
      })).describe("Top 5 concert events"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 concert events shown on this page. For each get: event name, venue, date/time, and starting ticket price.",
          schema,
        );
        if (data?.events?.length > 0) { results = data.events; console.log(`   ✅ Got ${data.events.length} events`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((e, i) => console.log(`  ${i + 1}. ${e.name} @ ${e.venue} | ${e.datetime} | ${e.price}`));
    } else { console.log("  No events extracted"); }

    fs.writeFileSync(path.join(__dirname, "ticketmaster_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    clearTimeout(watchdog);
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
