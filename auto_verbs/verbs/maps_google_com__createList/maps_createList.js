const { Stagehand } = require("@browserbasehq/stagehand");
const { PlaywrightRecorder, setupLLMClient, observeAndAct } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");

/**
 * Google Maps – Create Saved List
 *
 * AI-driven discovery: click Saved → Lists → create a new list,
 * then search for each place and add it to the list.
 */

const CFG = {
  url: "https://maps.google.com",
  listName: "urbana champaign dealerships",
  places: [
    "Napleton's Auto Park of Urbana",
    "Sam Leman Chevrolet of Champaign",
    "Champaign Urbana Auto Park",
  ],
};

async function main() {
  console.log("═".repeat(61));
  console.log("  Google Maps – Create Saved List");
  console.log("  🔍 AI-driven discovery + Playwright locators");
  console.log("═".repeat(61));
  console.log(`  📋 List name: ${CFG.listName}`);
  console.log(`  📍 Places: ${CFG.places.join(", ")}\n`);

  const llmClient = setupLLMClient("hybrid");
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    llmClient,
  });
  await stagehand.init();
  console.log("✅ Stagehand ready\n");

  const recorder = new PlaywrightRecorder();
  const context = stagehand.context;
  const page = context.pages()[0];

  try {
    // Step 1: Navigate to Google Maps
    console.log("🌐 Loading Google Maps...");
    await page.goto(CFG.url, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    recorder.record("goto", `Navigate to ${CFG.url}`);
    console.log(`✅ Loaded: ${page.url()}\n`);

    // Dismiss popups
    for (const sel of ["button:has-text('Accept all')", "button:has-text('Accept')", "button:has-text('OK')"]) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 500 })) {
          await btn.evaluate((el) => el.click());
          await page.waitForTimeout(500);
        }
      } catch {}
    }

    // Step 2: Click "Saved"
    console.log("🎯 STEP 1: Click Saved...");
    await observeAndAct(stagehand, 'Click the "Saved" button in the left sidebar', recorder);
    await page.waitForTimeout(2000);
    console.log("  ✅ Clicked Saved\n");

    // Step 3: Create a new list
    console.log("🎯 STEP 2: Create a new list...");
    await observeAndAct(stagehand, 'Click the button to create a new list (look for "New list" or a plus icon)', recorder);
    await page.waitForTimeout(2000);

    // Type list name
    console.log(`  Typing list name: "${CFG.listName}"`);
    await observeAndAct(stagehand, `Type "${CFG.listName}" in the list name input field`, recorder);
    await page.waitForTimeout(1000);

    // Save the list
    await observeAndAct(stagehand, 'Click "Save" or "Create" to create the list', recorder);
    await page.waitForTimeout(2000);
    console.log("  ✅ List created\n");

    // Step 4: Add each place to the list
    for (let i = 0; i < CFG.places.length; i++) {
      const placeName = CFG.places[i];
      console.log(`🎯 STEP ${3 + i}: Add "${placeName}" to the list...`);

      // Search for the place
      await observeAndAct(stagehand, 'Click the search box on Google Maps', recorder);
      await page.waitForTimeout(500);
      await stagehand.act(`Press Ctrl+A then type "${placeName}" in the search box`);
      await page.waitForTimeout(500);
      await observeAndAct(stagehand, 'Press Enter or click the search button to search', recorder);
      await page.waitForTimeout(2000);

      // Click on the first result if there's a results list
      try {
        const firstResult = page.locator("a[href*='/maps/place/']").first();
        if (await firstResult.isVisible({ timeout: 2000 })) {
          await firstResult.evaluate((el) => el.click());
          await page.waitForTimeout(2000);
        }
      } catch {}

      // Click Save on the place detail panel
      await observeAndAct(stagehand, 'Click the "Save" button on the place detail panel to save this place to a list', recorder);
      await page.waitForTimeout(2000);

      // Select our list
      await observeAndAct(stagehand, `Click on the list named "${CFG.listName}" to add this place to it`, recorder);
      await page.waitForTimeout(1000);

      // Close/done
      try {
        await observeAndAct(stagehand, 'Click "Done" or close the save dialog', recorder);
        await page.waitForTimeout(1000);
      } catch {}

      console.log(`  ✅ Added "${placeName}"\n`);
      recorder.record("add_place", `Added: ${placeName}`);
    }

    console.log("\n═".repeat(57));
    console.log(`  ✅ DONE — List "${CFG.listName}" created with ${CFG.places.length} places`);
    console.log("═".repeat(57));

  } catch (err) {
    console.error("❌ Error:", err.message);
  }

  // Save recorded actions
  const actionsPath = path.join(__dirname, "recorded_actions.json");
  fs.writeFileSync(actionsPath, JSON.stringify(recorder.actions, null, 2));
  console.log(`\n📋 Actions: ${actionsPath}`);

  // Generate Python script
  const pyCode = genPython(CFG, recorder);
  const pyPath = path.join(__dirname, "maps_createList.py");
  fs.writeFileSync(pyPath, pyCode);
  console.log(`✅ Python: ${pyPath}`);

  console.log("🧹 Closing...");
  await stagehand.close();
  console.log("🎊 Done!");
}

function genPython(cfg, recorder) {
  const ts = new Date().toISOString();
  const n = recorder.actions.length;
  return `"""
Google Maps – Create Saved List
List: "${cfg.listName}"
Places: ${cfg.places.map(p => `"${p}"`).join(", ")}

Generated on: ${ts}
Recorded ${n} browser interactions
Pure Playwright – no AI.
"""

import os
import sys
from dataclasses import dataclass
from typing import List
from playwright.sync_api import Playwright, sync_playwright


@dataclass(frozen=True)
class CreateListRequest:
    list_name: str
    places: List[str]


@dataclass(frozen=True)
class CreateListResult:
    list_name: str
    places_added: List[str]
    success: bool


# Create a saved list on Google Maps and add specified places to it.
def create_saved_list(playwright: Playwright, request: CreateListRequest) -> CreateListResult:
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
    places_added = []

    try:
        print(f"Loading Google Maps ...")
        page.goto("https://www.google.com/maps", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(2000)
        print(f"  Loaded: {page.url}")

        # Dismiss consent popups
        for sel in ["button:has-text('Accept all')", "button:has-text('Reject all')", "button:has-text('I agree')"]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=200):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(300)
            except Exception:
                pass

        # Step 1: Click Saved
        print("\\nSTEP 1: Click Saved ...")
        # TODO: fill in the selector for "Saved" discovered by JS exploration
        page.locator("SAVED_SELECTOR").click()
        page.wait_for_timeout(2000)

        # Step 2: Create new list
        print(f"\\nSTEP 2: Create list '{request.list_name}' ...")
        # TODO: fill in selectors discovered by JS exploration
        page.locator("NEW_LIST_SELECTOR").click()
        page.wait_for_timeout(1000)
        page.locator("LIST_NAME_INPUT").fill(request.list_name)
        page.locator("CREATE_BUTTON").click()
        page.wait_for_timeout(2000)

        # Step 3: Add each place
        for i, place_name in enumerate(request.places, 1):
            print(f"\\nSTEP {2 + i}: Add '{place_name}' ...")
            # Search for the place
            search_box = page.locator("input[aria-label='Search Google Maps']")
            search_box.click()
            page.keyboard.press("Control+a")
            search_box.fill(place_name)
            page.keyboard.press("Enter")
            page.wait_for_timeout(2000)

            # Click first result if list appears
            try:
                first = page.locator("a[href*='/maps/place/']").first
                if first.is_visible(timeout=1000):
                    first.evaluate("el => el.click()")
                    page.wait_for_timeout(2000)
            except Exception:
                pass

            # Click Save button on detail panel
            # TODO: fill in selector
            page.locator("SAVE_BUTTON").click()
            page.wait_for_timeout(1000)

            # Select the list
            # TODO: fill in selector
            page.locator("LIST_SELECTOR").click()
            page.wait_for_timeout(1000)

            # Close dialog
            # TODO: fill in selector
            try:
                page.locator("DONE_BUTTON").click()
                page.wait_for_timeout(500)
            except Exception:
                pass

            places_added.append(place_name)
            print(f"  ✅ Added")

    except Exception as e:
        import traceback
        print(f"Error: {e}")
        traceback.print_exc()
    finally:
        try:
            context.close()
        except Exception:
            pass

    success = len(places_added) == len(request.places)
    return CreateListResult(
        list_name=request.list_name,
        places_added=places_added,
        success=success,
    )


def test_create_list():
    request = CreateListRequest(
        list_name="${cfg.listName}",
        places=${JSON.stringify(cfg.places)},
    )
    with sync_playwright() as pw:
        result = create_saved_list(pw, request)

    print(f"\\n{'='*60}")
    print(f"  List: {result.list_name}")
    print(f"  Places added: {len(result.places_added)}/{len(request.places)}")
    print(f"  Success: {result.success}")
    print(f"{'='*60}")
    for p in result.places_added:
        print(f"  ✅ {p}")
    return result


if __name__ == "__main__":
    test_create_list()
`;
}

main().catch(console.error);
