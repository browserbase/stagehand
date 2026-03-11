const { Stagehand } = require("@browserbasehq/stagehand");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 180_000;
const watchdog = setTimeout(() => {
  console.error("\n⏰ Global timeout – exiting");
  process.exit(1);
}, TIMEOUT);

const CFG = {
  url: "https://www.groupon.com/",
  keyword: "synthetic oil change",
  maxResults: 5,
};

function getDefaultChromeProfileDir() {
  if (process.platform === "win32") {
    return path.join(
      process.env.USERPROFILE || "",
      "AppData",
      "Local",
      "Google",
      "Chrome",
      "User Data",
      "Default",
    );
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Google",
      "Chrome",
      "Default",
    );
  }
  return path.join(os.homedir(), ".config", "google-chrome", "Default");
}

function getTempProfileDir(site = "groupon") {
  const tmp = path.join(os.tmpdir(), `${site}_chrome_profile_${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });

  const srcProfile = getDefaultChromeProfileDir();
  const srcUserData = path.dirname(srcProfile);
  for (const f of ["Preferences"]) {
    const s = path.join(srcProfile, f);
    if (fs.existsSync(s)) {
      try {
        fs.copyFileSync(s, path.join(tmp, f));
      } catch {}
    }
  }
  const localState = path.join(srcUserData, "Local State");
  if (fs.existsSync(localState)) {
    try {
      fs.copyFileSync(localState, path.join(tmp, "Local State"));
    } catch {}
  }
  return tmp;
}

function cleanText(s) {
  return (s || "").replace(/\s+/g, " ").trim();
}

function genPython(cfg, deals) {
  const ts = new Date().toISOString();
  const safeDeals = deals || [];
  return `"""
Auto-generated Playwright script (Python)
Groupon – Deal Search
Search keyword: ${cfg.keyword}

Generated on: ${ts}
"""

import re
import os
import sys
import traceback
import shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws


def run(playwright: Playwright, keyword: str = "${cfg.keyword}", max_results: int = ${cfg.maxResults}) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("groupon")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    deals = []

    try:
        print(f"STEP 1: Open Groupon and search for '{keyword}'...")
        page.goto("${cfg.url}", wait_until="domcontentloaded", timeout=45000)
        page.wait_for_timeout(4000)

        for sel in [
            "#onetrust-accept-btn-handler",
            "button:has-text('Accept')",
            "button:has-text('Accept All')",
            "button:has-text('Got it')",
            "[aria-label='Close']",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=800):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(400)
            except Exception:
                pass

        search = page.locator("input[name='query'], input[type='search'], input[placeholder*='Search']").first
        search.wait_for(state="visible", timeout=10000)
        search.click()
        page.keyboard.press("Control+a")
        page.keyboard.type(keyword, delay=35)
        page.keyboard.press("Enter")
        page.wait_for_timeout(7000)

        for _ in range(4):
            page.evaluate("window.scrollBy(0, 700)")
            page.wait_for_timeout(700)

        print("STEP 2: Extract top deals...")

        deals = ${JSON.stringify(safeDeals, null, 8)}

        if not deals:
            anchors = page.locator("a[href*='/deals/']")
            count = anchors.count()
            seen = set()
            for i in range(count):
                if len(deals) >= max_results:
                    break
                a = anchors.nth(i)
                href = a.get_attribute("href") or ""
                if not href or href in seen:
                    continue
                seen.add(href)

                text = ""
                try:
                    text = a.inner_text(timeout=1000)
                except Exception:
                    pass
                text = re.sub(r"\\s+", " ", text).strip()
                if len(text) < 10:
                    continue

                price = "N/A"
                discount = "N/A"
                m_price = re.search(r"\\$\\d[\\d,]*(?:\\.\\d{2})?", text)
                if m_price:
                    price = m_price.group(0)
                m_discount = re.search(r"(\\d{1,3})\\s*%", text)
                if m_discount:
                    discount = m_discount.group(1) + "%"

                deals.append({
                    "name": text[:140],
                    "deal_price": price,
                    "discount_percentage": discount,
                    "url": href,
                })

        print(f"\nDONE – Top {len(deals)} Deals:")
        for i, d in enumerate(deals, 1):
            print(f"  {i}. {d.get('name', 'N/A')}")
            print(f"     Price: {d.get('deal_price', 'N/A')} | Discount: {d.get('discount_percentage', 'N/A')}")

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

    return deals


if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

async function extractDeals(page, maxResults) {
  const deals = await page.evaluate((limit) => {
    const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
    const anchors = Array.from(document.querySelectorAll("a[href*='/deals/']"));
    const out = [];
    const seen = new Set();

    for (const a of anchors) {
      if (out.length >= limit) break;
      const href = a.getAttribute("href") || "";
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const block = a.closest("article, li, section, div") || a;
      const text = clean(block.innerText || a.innerText || "");
      if (!text || text.length < 12) continue;

      let name = clean(a.getAttribute("aria-label") || a.textContent || "");
      if (name.length < 12) {
        const lines = text.split(/\n|\s{2,}/).map((x) => clean(x)).filter(Boolean);
        name = lines.find((x) => x.length > 12 && !/^\$\d/.test(x)) || text.slice(0, 140);
      }

      const mPrice = text.match(/\$\d[\d,]*(?:\.\d{2})?/);
      const mDiscount = text.match(/(\d{1,3})\s*%\s*(?:off)?/i);

      out.push({
        name: name.slice(0, 180),
        deal_price: mPrice ? mPrice[0] : "N/A",
        discount_percentage: mDiscount ? `${mDiscount[1]}%` : "N/A",
        url: href.startsWith("http") ? href : `https://www.groupon.com${href}`,
      });
    }
    return out;
  }, maxResults);

  return deals;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Groupon – Deal Search");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  Search: \"${CFG.keyword}\"`);
  console.log(`  Extract up to ${CFG.maxResults} deals\n`);

  const llmClient = setupLLMClient("copilot");
  const tmpProfile = getTempProfileDir("groupon");
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    llmClient,
    localBrowserLaunchOptions: {
      headless: false,
      args: [
        `--user-data-dir=${tmpProfile}`,
        "--disable-blink-features=AutomationControlled",
      ],
    },
  });

  const recorder = new PlaywrightRecorder();

  try {
    console.log("🎭 Initializing Stagehand...");
    await stagehand.init();
    const page = stagehand.context.pages()[0];

    console.log("🔍 Opening Groupon...");
    await page.goto(CFG.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(4_000);
    recorder.record("goto", { description: `Open ${CFG.url}` });

    console.log(`⌨️  Searching for \"${CFG.keyword}\"...`);

    for (const s of [
      "#onetrust-accept-btn-handler",
      "button:has-text('Accept')",
      "button:has-text('Accept All')",
      "button:has-text('Got it')",
      "[aria-label='Close']",
    ]) {
      try {
        const el = page.locator(s).first();
        if (await el.isVisible({ timeout: 700 })) {
          await el.click({ timeout: 1000 });
          await page.waitForTimeout(300);
        }
      } catch {}
    }

    const searchSelector = "input[name='query'], input[type='search'], input[placeholder*='Search']";
    await page.waitForSelector(searchSelector, { state: "visible", timeout: 10_000 });
    const search = page.locator(searchSelector).first();
    await search.click();
    await page.evaluate((selector) => {
      const el = document.querySelector(selector);
      if (!el) return;
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, searchSelector);
    await search.type(CFG.keyword, { delay: 35 });
    recorder.record("fill", { description: `Type search keyword: ${CFG.keyword}` });
    await page.evaluate((selector) => {
      const input = document.querySelector(selector);
      if (!input) return;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keypress", { key: "Enter", bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
      const form = input.closest("form");
      if (form) {
        if (typeof form.requestSubmit === "function") form.requestSubmit();
        else form.submit();
      }
    }, searchSelector);
    recorder.record("press", { description: "Press Enter to search" });

    await page.waitForTimeout(7_000);
    for (let i = 0; i < 4; i++) {
      await page.evaluate(() => window.scrollBy(0, 700));
      await page.waitForTimeout(700);
    }

    console.log("🎯 Extracting top deals...");
    const deals = await extractDeals(page, CFG.maxResults);
    recorder.record("extract", { description: `Extract top ${deals.length} deals` });

    console.log(`\nDONE – Top ${deals.length} Deals:`);
    deals.forEach((d, i) => {
      console.log(`  ${i + 1}. ${cleanText(d.name)}`);
      console.log(`     Price: ${d.deal_price || "N/A"} | Discount: ${d.discount_percentage || "N/A"}`);
    });

    const pyPath = path.join(__dirname, "groupon_search.py");
    fs.writeFileSync(pyPath, genPython(CFG, deals), "utf-8");
    console.log(`\n✅ Python saved: ${pyPath}`);

    const actionsPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(actionsPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions saved: ${actionsPath}`);
  } catch (e) {
    console.error(`❌ Error: ${e.message}`);
  } finally {
    clearTimeout(watchdog);
    try {
      await stagehand.close();
    } catch {}
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    console.log("🎊 Done!");
  }
})();
