/**
 * Spotify – Search for "jazz playlist"
 *
 * Prompt: Search "jazz playlist". Top 5 playlists (name, creator, songs, duration).
 * Uses open.spotify.com (web player). May require login.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

function getTempProfileDir(site = "spotify") {
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
  const playlists = results || [];
  return `"""
Spotify – Search for "jazz playlist"
Generated: ${ts}
Pure Playwright – no AI.
NOTE: May require Spotify login in Chrome profile.
"""
import re, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("spotify_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    playlists = []
    try:
        print("STEP 1: Navigate to Spotify search...")
        page.goto("https://open.spotify.com/search/jazz%20playlist", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)

        # dismiss cookie banner
        for sel in ["button:has-text('Accept')", "#onetrust-accept-btn-handler", "button:has-text('OK')"]:
            try:
                loc = page.locator(sel).first
                if loc.is_visible(timeout=800):
                    loc.evaluate("el => el.click()")
            except Exception:
                pass

        # Click on "Playlists" tab if available
        try:
            pl_tab = page.locator("button:has-text('Playlists'), a:has-text('Playlists')").first
            if pl_tab.is_visible(timeout=2000):
                pl_tab.evaluate("el => el.click()")
                page.wait_for_timeout(3000)
        except Exception:
            pass

        for _ in range(5):
            page.evaluate("window.scrollBy(0, 500)")
            page.wait_for_timeout(600)

        print("STEP 2: Extract playlist data...")
        playlists = ${JSON.stringify(playlists.length ? playlists : [], null, 8)}

        if not playlists:
            # Try card selectors
            cards = page.locator("[data-testid='card'], .Card, .contentSpacing").all()
            for card in cards[:5]:
                try:
                    txt = card.inner_text(timeout=3000)
                    lines = [l.strip() for l in txt.split("\\n") if l.strip()]
                    name = lines[0] if lines else "N/A"
                    creator = ""
                    for ln in lines[1:]:
                        if "by " in ln.lower() or "spotify" in ln.lower():
                            creator = ln[:60]
                            break
                    if not creator and len(lines) > 1:
                        creator = lines[1][:60]
                    playlists.append({"name": name, "creator": creator or "N/A", "num_songs": "N/A", "duration": "N/A"})
                except Exception:
                    pass

        if not playlists:
            body = page.locator("body").inner_text(timeout=10000)
            lines = [l.strip() for l in body.split("\\n") if l.strip()]
            for i, line in enumerate(lines):
                if "jazz" in line.lower() and "playlist" in line.lower() and len(line) < 80:
                    creator = lines[i+1][:60] if i+1 < len(lines) else "N/A"
                    playlists.append({"name": line, "creator": creator, "num_songs": "N/A", "duration": "N/A"})
                if len(playlists) >= 5:
                    break

        print(f"\\nDONE – Top {len(playlists)} Jazz Playlists:")
        for i, p in enumerate(playlists, 1):
            print(f"  {i}. {p.get('name','N/A')} | By: {p.get('creator','N/A')} | Songs: {p.get('num_songs','N/A')} | Duration: {p.get('duration','N/A')}")

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
    return playlists

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log('  Spotify – Search "jazz playlist"');
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
    console.log("🔍 Navigating to Spotify search...");
    await page.goto("https://open.spotify.com/search/jazz%20playlist", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(8000);
    recorder.record("goto", "Navigate to Spotify search");

    for (const s of ["button:has-text('Accept')", "#onetrust-accept-btn-handler"]) {
      try { const el = page.locator(s).first(); if (await el.isVisible({ timeout: 500 })) await el.click({ timeout: 1000 }); } catch {}
    }

    // Click Playlists tab
    try { await stagehand.act("Click on the Playlists tab or filter to show playlists"); } catch (e) { console.log(`   ⚠ playlists tab: ${e.message}`); }
    await page.waitForTimeout(3000);

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting playlists...");
    const schema = z.object({
      playlists: z.array(z.object({
        name:      z.string().describe("Playlist name"),
        creator:   z.string().describe("Playlist creator/author"),
        num_songs: z.string().describe("Number of songs"),
        duration:  z.string().describe("Total duration"),
      })).describe("Top 5 jazz playlists"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 playlists shown. For each get: playlist name, creator/author, number of songs, and total duration if available.",
          schema,
        );
        if (data?.playlists?.length > 0) { results = data.playlists; console.log(`   ✅ Got ${data.playlists.length} playlists`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(2000);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((p, i) => console.log(`  ${i + 1}. ${p.name} | By: ${p.creator} | Songs: ${p.num_songs} | ${p.duration}`));
    } else { console.log("  No playlists extracted (may need login)"); }

    fs.writeFileSync(path.join(__dirname, "spotify_search.py"), genPython(results), "utf-8");
    console.log("\n✅ Python saved");
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
