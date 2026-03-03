/**
 * ZocDoc – Search for "dentist" near San Francisco, CA
 *
 * Prompt: Search "dentist" near "San Francisco, CA". Filter "Highly Rated".
 *         Top 5 doctors (name, specialty, rating, earliest appointment).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "zocdoc") {
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
  const doctors = results || [];
  return `"""
ZocDoc – Dentist search near San Francisco, CA
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("zocdoc_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    doctors = []
    try:
        print("STEP 1: Navigate to ZocDoc search...")
        url = "https://www.zocdoc.com/search?address=San%20Francisco%2C%20CA&dr_specialty=dentist&sort_type=highly_rated"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Got it')", "[aria-label='Close']", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract doctor data...")
        doctors = ${JSON.stringify(doctors.length ? doctors : [], null, 8)}

        if not doctors:
            cards = page.locator("[data-test='provider-card'], .sc-provider-card, .provider-card").all()
            for card in cards[:5]:
                try:
                    txt = card.inner_text(timeout=3000)
                    lines = [l.strip() for l in txt.split("\\n") if l.strip()]
                    name = ""
                    specialty = ""
                    rating = ""
                    appt = ""
                    for ln in lines:
                        if re.search(r"^Dr\\.", ln) or (re.search(r"^[A-Z]", ln) and "DDS" in ln):
                            name = ln[:60]
                        elif any(w in ln.lower() for w in ["dentist", "dds", "orthodont", "endodont", "oral"]):
                            specialty = ln[:40]
                        elif re.search(r"\\d+\\.\\d+|★|star", ln, re.IGNORECASE):
                            rating = ln[:30]
                        elif re.search(r"(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|Mon|Tue|Wed|Thu|Fri|Sat|Sun|\\d{1,2}/\\d{1,2})", ln):
                            appt = ln[:50]
                    if name:
                        doctors.append({"name": name, "specialty": specialty or "Dentist", "rating": rating or "N/A", "earliest_appointment": appt or "N/A"})
                except Exception:
                    pass

        if not doctors:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            for i, line in enumerate(lines):
                if re.search(r"^Dr\\.|DDS|DMD", line) and len(line) < 80:
                    rating = ""
                    appt = ""
                    for j in range(i, min(i+8, len(lines))):
                        if re.search(r"\\d+\\.\\d+|★", lines[j]):
                            rating = lines[j][:30]
                        if re.search(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun|\\d{1,2}/\\d{1,2}|tomorrow|today)", lines[j], re.IGNORECASE):
                            appt = lines[j][:50]
                    doctors.append({"name": line[:60], "specialty": "Dentist", "rating": rating or "N/A", "earliest_appointment": appt or "N/A"})
                if len(doctors) >= 5:
                    break

        print(f"\\nDONE – Top {len(doctors)} Dentists:")
        for i, d in enumerate(doctors, 1):
            print(f"  {i}. {d.get('name','N/A')} | {d.get('specialty','N/A')} | {d.get('rating','N/A')} | {d.get('earliest_appointment','N/A')}")

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
    return doctors

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  ZocDoc – Dentist near San Francisco, CA (Highly Rated)");
  console.log("═══════════════════════════════════════════════════════════════\n");

  const llmClient = setupLLMClient("hybrid");
  const tmpProfile = getTempProfileDir();
  const stagehand = new Stagehand({
    env: "LOCAL", verbose: 0, llmClient,
    localBrowserLaunchOptions: {
      headless: false,
      viewport: { width: 1920, height: 1080 },
      args: [
        `--user-data-dir=${tmpProfile}`,
        "--disable-blink-features=AutomationControlled",
        "--start-maximized",
        "--window-size=1920,1080"
      ]
    },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];
  
  // Set viewport to full HD
  await page.setViewportSize({ width: 1920, height: 1080 });
  
  const recorder = new PlaywrightRecorder();

  try {
    // Direct URL with sort_type=highly_rated
    const url = "https://www.zocdoc.com/search?address=San%20Francisco%2C%20CA&dr_specialty=dentist&sort_type=highly_rated";
    console.log("🔍 Navigating to ZocDoc search...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8000);
    recorder.record("goto", "Navigate to ZocDoc dentist search");

    for (const s of ["button:has-text('Accept')", "button:has-text('Got it')", "[aria-label='Close']"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // If sort didn't work via URL, try AI act
    try { await stagehand.act('If there is a sort or filter option, select "Highly Rated" or sort by rating'); } catch (e) { console.log(`   ⚠ sort: ${e.message}`); }
    await page.waitForTimeout(3000);

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting doctors...");
    const schema = z.object({
      doctors: z.array(z.object({
        name:                  z.string().describe("Doctor's full name"),
        specialty:             z.string().describe("Specialty"),
        rating:                z.string().describe("Rating"),
        earliest_appointment:  z.string().describe("Earliest available appointment date/time"),
      })).describe("Top 5 dentists near San Francisco"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 dentists/doctors shown. For each get: doctor's full name, specialty, rating, and earliest available appointment date.",
          schema,
        );
        if (data?.doctors?.length > 0) { results = data.doctors; console.log(`   ✅ Got ${data.doctors.length} doctors`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((d, i) => console.log(`  ${i + 1}. ${d.name} | ${d.specialty} | ${d.rating} | ${d.earliest_appointment}`));
    } else { console.log("  No doctors extracted"); }

    fs.writeFileSync(path.join(__dirname, "zocdoc_search.py"), genPython(results), "utf-8");
    console.log("\n✅ Python saved");
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
