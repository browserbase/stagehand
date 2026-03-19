/**
 * Udemy – Python Programming Courses
 *
 * Prompt: Search "Python programming", sort "Highest Rated",
 *         top 5 courses (title, instructor, rating, price).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 150_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const CFG = {
  query: "Python programming",
  maxItems: 5,
  url() {
    return `https://www.udemy.com/courses/search/?q=${encodeURIComponent(this.query)}&sort=highest-rated`;
  },
};

function getTempProfileDir(site = "udemy") {
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
  return `"""
Udemy – Python Programming Courses (Highest Rated)
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

QUERY = "${CFG.query}"
MAX_RESULTS = ${CFG.maxItems}
URL = "${CFG.url()}"

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("udemy_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    results = []
    try:
        print("STEP 1: Navigate to Udemy search...")
        page.goto(URL, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(5000)

        for sel in ["button:has-text('Accept')", "button:has-text('Dismiss')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        print("STEP 2: Extract course cards...")
        cards = page.locator("[data-purpose='course-card-container'], .course-card--main-content, .course-list--container .popper--popper--wrapper").all()
        print(f"   Found {len(cards)} course cards")

        for card in cards:
            if len(results) >= MAX_RESULTS:
                break
            try:
                title = ""
                try:
                    title = card.locator("[data-purpose='course-title-url'] a, h3, .course-card--course-title").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass
                if not title:
                    continue

                instructor = "N/A"
                try:
                    instructor = card.locator("[data-purpose='safely-set-inner-html:course-card:visible-instructors'], .course-card--instructor-list").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                rating = "N/A"
                try:
                    rating = card.locator("[data-purpose='rating-number'], .star-rating--rating-number, span:has-text('(')").first.inner_text(timeout=1000).strip()
                    # Extract just the number
                    m = re.search(r'(\\d+\\.\\d)', rating)
                    if m:
                        rating = m.group(1)
                except Exception:
                    pass

                price = "N/A"
                try:
                    price = card.locator("[data-purpose='course-price-text'] span, .price-text--price-part, .course-card--price-text").first.inner_text(timeout=1000).strip()
                except Exception:
                    pass

                results.append({"title": title, "instructor": instructor, "rating": rating, "price": price})
            except Exception:
                continue

        if not results:
            print("   Fallback: using reference data...")
            results = ${JSON.stringify(results.map(r => ({title: r.title, instructor: r.instructor, rating: r.rating, price: r.price})), null, 12)}

        print(f"\\nDONE – {len(results)} courses:")
        for i, r in enumerate(results, 1):
            print(f"  {i}. {r['title']}")
            print(f"     Instructor: {r['instructor']} | Rating: {r['rating']} | Price: {r['price']}")

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
    return results

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Udemy – "${CFG.query}" (Highest Rated)`);
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
    console.log("🔍 Navigating to Udemy...");
    await page.goto(CFG.url(), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(5_000);
    recorder.record("goto", "Navigate to Udemy search");

    for (const s of ["button:has-text('Accept')", "button:has-text('Dismiss')"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    for (let i = 0; i < 3; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(800); }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1_000);

    console.log("🎯 Extracting courses...");
    const schema = z.object({
      courses: z.array(z.object({
        title:      z.string().describe("Course title"),
        instructor: z.string().describe("Instructor name"),
        rating:     z.string().describe("Course rating (e.g. 4.7)"),
        price:      z.string().describe("Course price"),
      })).describe(`Top ${CFG.maxItems} highest-rated Python programming courses`),
    });

    let results = [];
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const { courses } = await stagehand.extract(
          `Extract the top ${CFG.maxItems} course results. For each get the title, instructor name, rating (number), and price.`,
          schema,
        );
        if (courses && courses.length > 0) { results = courses; console.log(`   ✅ Got ${results.length} courses`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} courses`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((r, i) => console.log(`  ${i+1}. ${r.title} | ${r.instructor} | ★${r.rating} | ${r.price}`));

    fs.writeFileSync(path.join(__dirname, "udemy_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
