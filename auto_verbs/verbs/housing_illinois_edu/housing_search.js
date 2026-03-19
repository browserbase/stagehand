/**
 * Housing Illinois – Undergraduate Halls Cost Lookup
 *
 * Task: Navigate to https://www.housing.illinois.edu/cost
 * Select all Undergraduate Halls matching:
 *   - Meal plan: "Room & 12 Classic Meals + 15 Dining Dollars"
 *   - Room type: "Single"
 * Filter those within price range ($15,000 – $16,000).
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
  url: "https://www.housing.illinois.edu/cost",
  mealPlan: "Room & 12 Classic Meals + 15 Dining Dollars",
  roomType: "Single",
  priceMin: 15000,
  priceMax: 16000,
  waits: { page: 5000, select: 2000, extract: 3000 },
};

// ── Python Script Generator ──────────────────────────────────────────────────
function genPython(cfg, results, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  // Escape backticks in results for safe embedding
  const resultsJSON = JSON.stringify(results, null, 2);

  return `"""
Auto-generated Playwright script (Python)
Housing Illinois – Undergraduate Halls Cost Lookup

Meal plan: ${cfg.mealPlan}
Room type: ${cfg.roomType}
Price range: $${cfg.priceMin} – $${cfg.priceMax}

Generated on: ${ts}
Recorded ${n} browser interactions

Uses Playwright's native locator API with the user's Chrome profile.
"""

import re
import os
import sys
from dataclasses import dataclass
from playwright.sync_api import Playwright, sync_playwright


@dataclass(frozen=True)
class HousingSearchRequest:
    meal_plan: str = "${cfg.mealPlan}"
    room_type: str = "${cfg.roomType}"
    price_min: int = ${cfg.priceMin}
    price_max: int = ${cfg.priceMax}


@dataclass(frozen=True)
class HallResult:
    name: str
    meal_plan: str
    room_type: str
    price: int


@dataclass(frozen=True)
class HousingSearchResult:
    halls: list
    meal_plan: str
    room_type: str
    price_range: tuple


def search_housing(playwright: Playwright, request: HousingSearchRequest = None) -> HousingSearchResult:
    if request is None:
        request = HousingSearchRequest()

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
    halls = []

    try:
        print("Loading housing.illinois.edu/cost ...")
        page.goto("${cfg.url}")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)

        # TODO: Steps will be filled in after AI exploration
        # STEP 1: Select the meal plan
        # STEP 2: Select single room type
        # STEP 3: Extract undergraduate hall names and prices
        # STEP 4: Filter by price range

        print(f"\\nFound {len(halls)} halls matching criteria:")
        for i, h in enumerate(halls, 1):
            print(f"  {i}. {h.name} — {h.price}")

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            context.close()
        except Exception:
            pass

    return HousingSearchResult(
        halls=halls,
        meal_plan=request.meal_plan,
        room_type=request.room_type,
        price_range=(request.price_min, request.price_max),
    )


if __name__ == "__main__":
    with sync_playwright() as playwright:
        result = search_housing(playwright)
        print(f"\\nTotal halls found: {len(result.halls)}")
`;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Housing Illinois – Undergraduate Halls Cost Lookup");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`  🍽️  Meal plan: ${CFG.mealPlan}`);
  console.log(`  🛏️  Room type: ${CFG.roomType}`);
  console.log(`  💰 Price range: $${CFG.priceMin.toLocaleString()} – $${CFG.priceMax.toLocaleString()}\n`);

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
          "AppData",
          "Local",
          "Google",
          "Chrome",
          "User Data",
          "Default"
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
    // STEP 0: Navigate to the cost page
    // ══════════════════════════════════════════════════════════════════════
    console.log("🌐 Loading housing.illinois.edu/cost ...");
    recorder.goto(CFG.url);
    await page.goto(CFG.url);
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(CFG.waits.page);
    console.log(`✅ Loaded: ${page.url()}\n`);

    // Dismiss any popups / cookie banners
    for (const selector of [
      "button:has-text('Accept')",
      "button:has-text('Got it')",
      "button:has-text('OK')",
      "button:has-text('Close')",
      "[aria-label='Close']",
    ]) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 1500 })) {
          await btn.click();
          await page.waitForTimeout(500);
        }
      } catch (e) {
        /* no popup */
      }
    }

    // ══════════════════════════════════════════════════════════════════════
    // STEP 1: Select the meal plan dropdown/option
    // ══════════════════════════════════════════════════════════════════════
    console.log(`🎯 STEP 1: Select meal plan = "${CFG.mealPlan}" ...`);

    await observeAndAct(
      stagehand,
      page,
      recorder,
      `Find and click the meal plan dropdown or selector on this page`,
      "Open meal plan dropdown"
    );
    await page.waitForTimeout(CFG.waits.select);

    await observeAndAct(
      stagehand,
      page,
      recorder,
      `Select the option "${CFG.mealPlan}" from the meal plan list or dropdown`,
      "Select meal plan option"
    );
    await page.waitForTimeout(CFG.waits.select);
    console.log(`   ✅ Selected meal plan\n`);

    // ══════════════════════════════════════════════════════════════════════
    // STEP 2: Select room type "Single"
    // ══════════════════════════════════════════════════════════════════════
    console.log(`🎯 STEP 2: Filter by room type = "${CFG.roomType}" ...`);

    await observeAndAct(
      stagehand,
      page,
      recorder,
      `Find and click the room type filter or column/tab for "${CFG.roomType}" rooms`,
      "Select Single room type"
    );
    await page.waitForTimeout(CFG.waits.select);
    console.log(`   ✅ Selected room type\n`);

    // ══════════════════════════════════════════════════════════════════════
    // STEP 3: Extract all undergraduate hall names and prices
    // ══════════════════════════════════════════════════════════════════════
    console.log("🎯 STEP 3: Extract undergraduate hall data ...\n");

    const extracted = await stagehand.extract(
      `Extract all Undergraduate residence hall names and their corresponding prices for the "${CFG.roomType}" room type with the "${CFG.mealPlan}" meal plan. For each hall, get the hall name and the numeric annual price.`,
      z.object({
        halls: z.array(
          z.object({
            name: z.string().describe("Residence hall name"),
            price: z
              .string()
              .describe(
                "Annual price as a string, e.g. '$15,234' or '15234'"
              ),
          })
        ),
      })
    );

    recorder.record("extract", {
      instruction: "Extract undergraduate hall names and prices",
      description:
        "Extract hall names and prices for Single room with selected meal plan",
      results: extracted,
    });

    console.log(`📋 Extracted ${extracted.halls.length} halls (raw):`);
    extracted.halls.forEach((h, i) => {
      console.log(`   ${i + 1}. ${h.name} — ${h.price}`);
    });

    // ══════════════════════════════════════════════════════════════════════
    // STEP 4: Filter by price range
    // ══════════════════════════════════════════════════════════════════════
    console.log(
      `\n🎯 STEP 4: Filter to price range $${CFG.priceMin.toLocaleString()} – $${CFG.priceMax.toLocaleString()} ...\n`
    );

    function parsePrice(priceStr) {
      const m = priceStr.match(/[\d,]+/);
      if (!m) return 0;
      return parseInt(m[0].replace(/,/g, ""), 10) || 0;
    }

    const filtered = extracted.halls.filter((h) => {
      const p = parsePrice(h.price);
      return p > CFG.priceMin && p < CFG.priceMax;
    });

    console.log(
      `✅ ${filtered.length} halls in range ($${CFG.priceMin.toLocaleString()} – $${CFG.priceMax.toLocaleString()}):`
    );
    filtered.forEach((h, i) => {
      console.log(`   ${i + 1}. ${h.name} — ${h.price}`);
    });

    // Also collect ARIA scope info for key elements found during extraction
    // This helps the generated Python code use stable selectors.
    console.log("\n📋 Collecting ARIA scope info for key page elements ...");
    try {
      // Try to get ARIA info for the table/list that contains the hall data
      const tableObs = await stagehand.observe(
        "Find the table or list that contains undergraduate residence hall pricing data"
      );
      if (tableObs[0]) {
        const ariaScope = await extractAriaScopeForXPath(
          page,
          tableObs[0].selector
        );
        console.log(
          "   📋 Table ARIA scope:",
          JSON.stringify(ariaScope, null, 2)
        );
        recorder.record("aria-scope", {
          element: "pricing-table",
          selector: tableObs[0].selector,
          ariaScope,
        });
      }
    } catch (e) {
      console.log(`   ⚠️  Could not collect ARIA scope: ${e.message}`);
    }

    // ══════════════════════════════════════════════════════════════════════
    // Save outputs
    // ══════════════════════════════════════════════════════════════════════
    console.log("\n═══════════════════════════════════════════════════════════");
    console.log(`  ✅ DONE — ${filtered.length} halls matched`);
    console.log("═══════════════════════════════════════════════════════════");
    filtered.forEach((h, i) => {
      console.log(`  ${i + 1}. ${h.name} — ${h.price}`);
    });

    // Save Python script
    const pyScript = genPython(CFG, filtered, recorder);
    const pyPath = path.join(__dirname, "housing_search.py");
    fs.writeFileSync(pyPath, pyScript, "utf-8");
    console.log(`\n✅ Python: ${pyPath}`);

    // Save recorded actions JSON
    const jsonPath = path.join(__dirname, "recorded_actions.json");
    fs.writeFileSync(
      jsonPath,
      JSON.stringify(recorder.actions, null, 2),
      "utf-8"
    );
    console.log(`📋 Actions: ${jsonPath}`);

    return { extracted, filtered };
  } catch (err) {
    console.error("\n❌ Error:", err.message);
    console.error(err.stack);
    if (recorder?.actions.length > 0) {
      const pyScript = genPython(CFG, [], recorder);
      fs.writeFileSync(
        path.join(__dirname, "housing_search.py"),
        pyScript,
        "utf-8"
      );
      console.log("⚠️  Partial Python saved");
    }
    throw err;
  } finally {
    if (stagehand) {
      console.log("🧹 Closing...");
      await stagehand.close();
    }
    clearTimeout(_timer);
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("🎊 Done!");
      process.exit(0);
    })
    .catch((e) => {
      console.error("💥", e.message);
      process.exit(1);
    });
}

module.exports = { main };
