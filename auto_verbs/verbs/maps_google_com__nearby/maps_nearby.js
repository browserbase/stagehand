/**
 * Google Maps – Nearby Dealerships Search
 *
 * Task: Search for "dealerships" near "urbana champaign" on Google Maps.
 * Click into each of the first 5 result cards to obtain:
 *   - Business name, address, review score, phone number, website URL
 * Return the list.
 *
 * Uses AI-driven discovery to interact with the page,
 * records interactions, and generates a Python Playwright script.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  setupLLMClient,
  PlaywrightRecorder,
  observeAndAct,
  extractAriaScopeForXPath,
} = require("../../stagehand-utils");

const TIMEOUT = 300_000;
const _timer = setTimeout(() => {
  console.error("\n⏰ Global timeout");
  process.exit(1);
}, TIMEOUT);

const CFG = {
  url: "https://www.google.com/maps",
  query: "dealerships",
  location: "urbana champaign",
  maxResults: 5,
  waits: { page: 5000, search: 5000, detail: 3000
  },
};

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Google Maps – Nearby Search");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🔎 Query: ${CFG.query} near ${CFG.location}`);
  console.log(`  📋 Max results: ${CFG.maxResults}\n`);

  const recorder = new PlaywrightRecorder();
  const llmClient = setupLLMClient("hybrid");
  let stagehand;

  try {
    console.log("🎭 Initializing Stagehand...");
    stagehand = new Stagehand({
      env: "LOCAL",
      verbose: 0,
      llmClient,
      localBrowserLaunchOptions: {
        userDataDir: path.join(
          os.homedir(),
          "AppData", "Local", "Google", "Chrome", "User Data", "Default"
        ),
        headless: false,
        viewport: { width: 1920, height: 1080 },
        args: [
          "--disable-blink-features=AutomationControlled",
          "--disable-infobars",
          "--disable-extensions",
          "--start-maximized",
          "--window-size=1920,1080",
        ],
      },
    });
    await stagehand.init();
    console.log("✅ Stagehand ready\n");

    const page = stagehand.context.pages()[0];

    // ══════════════════════════════════════════════════════════════════════
    // STEP 0: Navigate to Google Maps
    // ══════════════════════════════════════════════════════════════════════
    console.log("🌐 Loading Google Maps...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(CFG.waits.page);
    console.log(`✅ Loaded: ${page.url()}\n`);

    // Dismiss popups
    for (const selector of [
      "button:has-text('Accept all')",
      "button:has-text('Accept')",
      "button:has-text('OK')",
      "[aria-label='Close']",
    ]) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click();
          await page.waitForTimeout(500);
        }
      } catch (e) { /* no popup */ }
    }

    // ══════════════════════════════════════════════════════════════════════
    // STEP 1: Search for dealerships near urbana champaign
    // ══════════════════════════════════════════════════════════════════════
    const searchQuery = `${CFG.query} near ${CFG.location}`;
    console.log(`🎯 STEP 1: Search for "${searchQuery}" ...`);

    await observeAndAct(
      stagehand, page, recorder,
      `Click the search box on Google Maps`,
      "Click search box"
    );
    await page.waitForTimeout(500);

    await stagehand.act(`Type '${searchQuery}' into the search box`);
    recorder.record("act", { instruction: `Type search query`, description: `Type '${searchQuery}'`, method: "type" });
    await page.waitForTimeout(1000);

    await stagehand.act("Press Enter to search");
    recorder.record("act", { instruction: "Press Enter", description: "Submit search", method: "keypress" });
    await page.waitForTimeout(CFG.waits.search);
    console.log(`   ✅ Searched for "${searchQuery}"\n`);

    // Wait for results to load
    await page.waitForTimeout(5000);

    // ══════════════════════════════════════════════════════════════════════
    // STEP 2: Click into each result and extract details
    // ══════════════════════════════════════════════════════════════════════
    console.log(`🎯 STEP 2: Extract details for up to ${CFG.maxResults} results ...\n`);

    const results = [];

    for (let i = 0; i < CFG.maxResults; i++) {
      console.log(`  --- Result ${i + 1} ---`);

      // If not the first, go back to results list
      if (i > 0) {
        await stagehand.act("Click the back arrow button to return to the search results list");
        await page.waitForTimeout(CFG.waits.detail);
      }

      // Click on the nth result
      try {
        await stagehand.act(`Click the ${ordinal(i + 1)} business result in the search results list (not an ad)`);
        await page.waitForTimeout(CFG.waits.detail);
      } catch (e) {
        console.log(`   ⚠️ Could not click result ${i + 1}: ${e.message}`);
        continue;
      }

      // Extract business details from the detail panel
      try {
        const detail = await stagehand.extract(
          `Extract the business details from the currently visible business detail panel on Google Maps. Get the business name, full address, star rating (e.g. "4.5"), phone number, and website URL. If a field is not available, return "N/A".`,
          z.object({
            name: z.string().describe("Business name"),
            address: z.string().describe("Full street address"),
            rating: z.string().describe("Star rating, e.g. '4.5'"),
            phone: z.string().describe("Phone number"),
            website: z.string().describe("Website URL"),
          })
        );

        console.log(`   📋 ${detail.name}`);
        console.log(`      📍 ${detail.address}`);
        console.log(`      ⭐ ${detail.rating}`);
        console.log(`      📞 ${detail.phone}`);
        console.log(`      🌐 ${detail.website}`);

        results.push(detail);

        recorder.record("extract", {
          instruction: `Extract business detail ${i + 1}`,
          description: `Extracted: ${detail.name}`,
          results: detail,
        });
      } catch (e) {
        console.log(`   ⚠️ Could not extract details for result ${i + 1}: ${e.message}`);
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // Print and save results
    // ══════════════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${results.length} businesses found`);
    console.log("═══════════════════════════════════════════════════════════");
    results.forEach((r, i) => {
      console.log(`  ${i + 1}. ${r.name}`);
      console.log(`     ${r.address} | ⭐${r.rating} | ${r.phone} | ${r.website}`);
    });

    // Generate Python script
    const pyScript = genPython(CFG, results, recorder);
    const pyPath = path.join(__dirname, "maps_nearby.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python: ${pyPath}`);

    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(jsonPath, JSON.stringify(recorder.actions, null, 2), "utf-8");
    console.log(`📋 Actions: ${jsonPath}`);

    return results;
  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
    throw err;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing...");
      await stagehand.close();
    }
    clearTimeout(_timer);
  }
}

function ordinal(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, results, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Google Maps – Nearby Search
Search: "${cfg.query}" near "${cfg.location}"

Generated on: ${ts}
Recorded ${n} browser interactions
Pure Playwright – no AI.
"""

import re
import os
import sys
from dataclasses import dataclass
from typing import List
from playwright.sync_api import Playwright, sync_playwright


@dataclass(frozen=True)
class NearbySearchRequest:
    query: str
    location: str
    max_results: int = 5


@dataclass(frozen=True)
class BusinessDetail:
    name: str
    address: str
    rating: str
    phone: str
    website: str


@dataclass(frozen=True)
class NearbySearchResult:
    query: str
    location: str
    businesses: List[BusinessDetail]


# Search Google Maps for nearby businesses, click into each result card,
# and extract name, address, review score, phone, and website URL.
def search_nearby(playwright: Playwright, request: NearbySearchRequest) -> NearbySearchResult:
    user_data_dir = os.path.join(
        os.environ["USERPROFILE"],
        "AppData", "Local", "Google", "Chrome", "User Data", "Default"
    )
    context = playwright.chromium.launch_persistent_context(
        user_data_dir,
        channel="chrome",
        headless=False,
        viewport=None,
        args=[
            "--disable-blink-features=AutomationControlled",
            "--disable-infobars",
            "--disable-extensions",
        ],
    )
    page = context.pages[0] if context.pages else context.new_page()
    businesses = []

    try:
        search_text = f"{request.query} near {request.location}"
        print(f"Loading Google Maps with query: {search_text} ...")
        encoded = search_text.replace(" ", "+")
        page.goto(f"https://www.google.com/maps/search/{encoded}/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(8000)
        print(f"  Loaded: {page.url}")

        # Dismiss popups
        for sel in ["button:has-text('Accept all')", "button:has-text('Accept')",
                     "button:has-text('OK')", "[aria-label='Close']"]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=1500):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass

        # Wait for result cards
        page.wait_for_timeout(3000)

        # Get result card elements in the sidebar feed
        feed = page.locator("[role='feed']").first
        cards = feed.locator("[jsaction*='mouseover']").all()
        print(f"  Found {len(cards)} result cards")

        for i in range(min(request.max_results, len(cards))):
            print(f"\\n  --- Result {i+1} ---")

            # Re-query cards in case DOM changed after navigation
            feed = page.locator("[role='feed']").first
            cards = feed.locator("[jsaction*='mouseover']").all()
            if i >= len(cards):
                break

            # Click the card to open detail panel
            cards[i].evaluate("el => el.click()")
            page.wait_for_timeout(4000)

            # Extract details from the info panel
            detail = _extract_detail(page)
            print(f"    Name:    {detail['name']}")
            print(f"    Address: {detail['address']}")
            print(f"    Rating:  {detail['rating']}")
            print(f"    Phone:   {detail['phone']}")
            print(f"    Website: {detail['website']}")

            businesses.append(BusinessDetail(
                name=detail["name"],
                address=detail["address"],
                rating=detail["rating"],
                phone=detail["phone"],
                website=detail["website"],
            ))

            # Go back to results list
            try:
                back_btn = page.locator("[aria-label='Back'], button[jsaction*='back']").first
                back_btn.evaluate("el => el.click()")
                page.wait_for_timeout(3000)
            except Exception:
                page.keyboard.press("Escape")
                page.wait_for_timeout(2000)

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            context.close()
        except Exception:
            pass

    return NearbySearchResult(
        query=request.query,
        location=request.location,
        businesses=businesses,
    )


def _extract_detail(page):
    detail = {"name": "N/A", "address": "N/A", "rating": "N/A", "phone": "N/A", "website": "N/A"}
    body_text = page.inner_text("body")

    # Name: first heading in the detail panel
    for sel in ["h1", "[role='main'] h1", "[data-attrid='title'] span"]:
        try:
            el = page.locator(sel).first
            val = el.inner_text(timeout=2000).strip()
            if val:
                detail["name"] = val
                break
        except Exception:
            continue

    # Rating
    for sel in ["[role='img'][aria-label*='star']", "span[aria-label*='star']",
                "span:has-text('stars')"]:
        try:
            el = page.locator(sel).first
            label = el.get_attribute("aria-label") or el.inner_text(timeout=1000)
            m = re.search(r"([\\d.]+)", label)
            if m:
                detail["rating"] = m.group(1)
                break
        except Exception:
            continue

    # Address: button with data-tooltip containing address info or aria-label with address
    for sel in ["[data-item-id='address'] .fontBodyMedium",
                "button[data-item-id='address']",
                "[aria-label*='Address']"]:
        try:
            el = page.locator(sel).first
            val = el.inner_text(timeout=2000).strip()
            if val and len(val) > 5:
                detail["address"] = val
                break
        except Exception:
            continue

    # Phone
    for sel in ["[data-item-id*='phone'] .fontBodyMedium",
                "button[data-item-id*='phone']",
                "[aria-label*='Phone']"]:
        try:
            el = page.locator(sel).first
            val = el.inner_text(timeout=2000).strip()
            m = re.search(r"[\\(\\d][\\d\\s\\-\\(\\)\\+]{6,}", val)
            if m:
                detail["phone"] = m.group(0).strip()
                break
        except Exception:
            continue

    # Website
    for sel in ["a[data-item-id='authority']",
                "[data-item-id*='authority'] a",
                "a[aria-label*='Website']"]:
        try:
            el = page.locator(sel).first
            val = el.get_attribute("href") or ""
            if val and "google" not in val:
                detail["website"] = val
                break
            text = el.inner_text(timeout=1000).strip()
            if text and "." in text:
                detail["website"] = text
                break
        except Exception:
            continue

    return detail


def test_search_nearby():
    request = NearbySearchRequest(
        query="dealerships",
        location="urbana champaign",
        max_results=5,
    )
    with sync_playwright() as pw:
        result = search_nearby(pw, request)

    print(f"\\n{'='*60}")
    print(f"  Results: {len(result.businesses)} businesses")
    print(f"  Query: {result.query} near {result.location}")
    print(f"{'='*60}")
    for i, b in enumerate(result.businesses, 1):
        print(f"  {i}. {b.name}")
        print(f"     {b.address} | Rating: {b.rating} | {b.phone} | {b.website}")
    return result


if __name__ == "__main__":
    test_search_nearby()
`;
}

if (require.main === module) {
  main()
    .then(() => { console.log("🎊 Done!"); process.exit(0); })
    .catch((e) => { console.error("💥", e.message); process.exit(1); });
}

module.exports = { main };
