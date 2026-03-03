/**
 * Indeed – "Data Analyst" jobs, Remote, sort by Date
 *
 * Prompt: Search "Data Analyst" in "Remote". Sort by "Date".
 *         Top 5 jobs (title, company, salary, posted date).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "indeed") {
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
Indeed – Data Analyst jobs, Remote, sorted by Date
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("indeed_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    jobs = []
    try:
        # sort=date for sorting by date, sc=0kf:attr(DSQF7)%3B → remote filter
        print("STEP 1: Navigate to Indeed job search...")
        url = "https://www.indeed.com/jobs?q=Data+Analyst&l=Remote&sort=date"
        page.goto(url, wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # dismiss popups
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('Close')", "[aria-label='close']"]:
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
            cards = page.locator(".job_seen_beacon, .result, .jobsearch-ResultsList > li, [data-testid='job-card']").all()
            for card in cards[:5]:
                try:
                    txt = card.inner_text(timeout=3000)
                    lines = [l.strip() for l in txt.split("\\n") if l.strip()]
                    title = ""
                    company = ""
                    salary = "N/A"
                    posted = ""
                    for ln in lines:
                        if not title and len(ln) > 5 and len(ln) < 80:
                            title = ln
                        elif not company and len(ln) > 2 and len(ln) < 60:
                            company = ln
                        if re.search(r"\\$[\\d,]+", ln):
                            salary = ln[:60]
                        if any(w in ln.lower() for w in ["ago", "posted", "today", "just posted", "day", "hour"]):
                            posted = ln[:40]
                    jobs.append({"title": title or "N/A", "company": company or "N/A", "salary": salary, "posted_date": posted or "N/A"})
                except Exception:
                    pass

        if not jobs:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            for i, line in enumerate(lines):
                if "analyst" in line.lower() and len(line) < 80:
                    company = lines[i+1][:60] if i+1 < len(lines) else "N/A"
                    salary = "N/A"
                    posted = ""
                    for j in range(i, min(i+6, len(lines))):
                        if re.search(r"\\$[\\d,]+", lines[j]):
                            salary = lines[j][:60]
                        if any(w in lines[j].lower() for w in ["ago", "posted", "today"]):
                            posted = lines[j][:40]
                    jobs.append({"title": line[:80], "company": company, "salary": salary, "posted_date": posted or "N/A"})
                if len(jobs) >= 5:
                    break

        print(f"\\nDONE – Top {len(jobs)} Data Analyst Jobs:")
        for i, j in enumerate(jobs, 1):
            print(f"  {i}. {j.get('title','N/A')} | {j.get('company','N/A')} | {j.get('salary','N/A')} | {j.get('posted_date','N/A')}")

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
  console.log("  Indeed – Data Analyst jobs, Remote, sorted by Date");
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
    // sort=date means sort by most recent
    const url = "https://www.indeed.com/jobs?q=Data+Analyst&l=Remote&sort=date";
    console.log("🔍 Navigating to Indeed job search...");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8000);
    recorder.record("goto", "Navigate to Indeed job search");

    for (const s of ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('Close')", "[aria-label='close']"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting job listings...");
    const schema = z.object({
      jobs: z.array(z.object({
        title:       z.string().describe("Job title"),
        company:     z.string().describe("Company name"),
        salary:      z.string().describe("Salary if listed, otherwise N/A"),
        posted_date: z.string().describe("When the job was posted"),
      })).describe("Top 5 Data Analyst remote jobs sorted by date"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 job listings shown. For each get: job title, company name, salary (if listed), and posted date.",
          schema,
        );
        if (data?.jobs?.length > 0) { results = data.jobs; console.log(`   ✅ Got ${data.jobs.length} jobs`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((j, i) => console.log(`  ${i + 1}. ${j.title} | ${j.company} | ${j.salary} | ${j.posted_date}`));
    } else { console.log("  No jobs extracted"); }

    fs.writeFileSync(path.join(__dirname, "indeed_search.py"), genPython(results), "utf-8");
    console.log("\n✅ Python saved");
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
