/**
 * LinkedIn – Job search for Software Engineer in Seattle
 *
 * Prompt: Search "Software Engineer" in "Seattle, WA". Filter by "Past week".
 *         Top 5 jobs (title, company, location, posted date).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "linkedin") {
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
  const jobs = results || [];
  return `"""
LinkedIn – Software Engineer jobs in Seattle WA
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("linkedin_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    jobs = []
    try:
        # f_TPR=r604800 = Past week filter
        print("STEP 1: Navigate to LinkedIn job search...")
        url = "https://www.linkedin.com/jobs/search/?keywords=Software%20Engineer&location=Seattle%2C%20WA&f_TPR=r604800"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # dismiss popups
        for sel in ["button:has-text('Accept')", "button:has-text('Dismiss')", "[aria-label='Dismiss']"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract job listings...")
        jobs = ${JSON.stringify(jobs.length ? jobs : [], null, 8)}

        if not jobs:
            # Try job card selectors (works for logged-in and guest views)
            cards = page.locator(".base-card, .job-search-card, .jobs-search-results__list-item, li.result-card").all()
            for card in cards[:5]:
                try:
                    txt = card.inner_text(timeout=3000)
                    lines = [l.strip() for l in txt.split("\\n") if l.strip()]
                    title = lines[0] if lines else "N/A"
                    company = lines[1] if len(lines) > 1 else "N/A"
                    location = lines[2] if len(lines) > 2 else "N/A"
                    posted = ""
                    for ln in lines:
                        if any(w in ln.lower() for w in ["ago", "day", "hour", "week", "month", "just now"]):
                            posted = ln[:40]
                            break
                    jobs.append({"title": title, "company": company, "location": location, "posted_date": posted or "N/A"})
                except Exception:
                    pass

        if not jobs:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            i = 0
            while i < len(lines) and len(jobs) < 5:
                if "engineer" in lines[i].lower() or "developer" in lines[i].lower() or "software" in lines[i].lower():
                    title = lines[i][:80]
                    company = lines[i+1] if i+1 < len(lines) else "N/A"
                    location = lines[i+2] if i+2 < len(lines) else "N/A"
                    posted = ""
                    for j in range(i, min(i+5, len(lines))):
                        if any(w in lines[j].lower() for w in ["ago", "day", "hour", "week"]):
                            posted = lines[j][:40]
                            break
                    jobs.append({"title": title, "company": company, "location": location, "posted_date": posted or "N/A"})
                    i += 4
                else:
                    i += 1

        print(f"\\nDONE – Top {len(jobs)} Jobs:")
        for i, j in enumerate(jobs, 1):
            print(f"  {i}. {j.get('title','N/A')} | {j.get('company','N/A')} | {j.get('location','N/A')} | {j.get('posted_date','N/A')}")

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
    return jobs

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  LinkedIn – Software Engineer jobs in Seattle, WA");
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
    // f_TPR=r604800 → Past week
    const url = "https://www.linkedin.com/jobs/search/?keywords=Software%20Engineer&location=Seattle%2C%20WA&f_TPR=r604800";
    console.log("🔍 Navigating to LinkedIn job search...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8000);
    recorder.record("goto", "Navigate to LinkedIn job search");

    for (const s of ["button:has-text('Accept')", "button:has-text('Dismiss')", "[aria-label='Dismiss']"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting job listings...");
    const schema = z.object({
      jobs: z.array(z.object({
        title:       z.string().describe("Job title"),
        company:     z.string().describe("Company name"),
        location:    z.string().describe("Job location"),
        posted_date: z.string().describe("When the job was posted"),
      })).describe("Top 5 Software Engineer jobs in Seattle"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 job listings shown. For each get: job title, company name, location, and posted date.",
          schema,
        );
        if (data?.jobs?.length > 0) { results = data.jobs; console.log(`   ✅ Got ${data.jobs.length} jobs`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((j, i) => console.log(`  ${i + 1}. ${j.title} | ${j.company} | ${j.location} | ${j.posted_date}`));
    } else { console.log("  No jobs extracted"); }

    fs.writeFileSync(path.join(__dirname, "linkedin_search.py"), genPython(results), "utf-8");
    console.log("\n✅ Python saved");
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
