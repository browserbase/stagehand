"""
Housing Illinois – Undergraduate Halls Cost Lookup
Pure Playwright – no AI.

Navigates to https://www.housing.illinois.edu/cost, expands the
"New Resident Rates" accordion, extracts undergraduate hall pricing
for a given meal plan prefix and room type, then filters by price range.

Meal plan prefixes:
  "Room & 12 Classic Meals"
  "Room & 10 Classic Meals"
  "Room & All Dining Dollars"
  "Room & All Classic Meals"

Room types: "Single", "Double", "Triple"
"""

import re
import os
import sys
from dataclasses import dataclass
from typing import List, Tuple
from playwright.sync_api import Playwright, sync_playwright


@dataclass(frozen=True)
class HousingSearchRequest:
    """Parameters for the housing cost search."""
    meal_plan: str          # Full meal-plan row label, e.g. "Room & 12 Classic Meals + 15 Dining Dollars"
    room_type: str          # Column header to match, e.g. "Single", "Double", "Triple"
    price_min: int          # Lower bound of price filter (exclusive)
    price_max: int          # Upper bound of price filter (exclusive)


@dataclass(frozen=True)
class HallPricing:
    """A single undergraduate hall with its price for the requested room/meal combo."""
    hall_name: str
    meal_plan: str
    room_type: str
    price: int              # Annual price in whole dollars


@dataclass(frozen=True)
class HousingSearchResult:
    """Return value: filtered list of halls plus the search criteria used."""
    halls: List[HallPricing]
    meal_plan: str
    room_type: str
    price_min: int
    price_max: int


# Search undergraduate hall pricing on housing.illinois.edu/cost.
# Opens the "New Resident Rates" accordion, finds all halls whose table
# contains a column matching the requested room_type and a row matching
# the requested meal_plan, then returns only those within (price_min, price_max).
def search_housing_cost(playwright: Playwright, request: HousingSearchRequest) -> HousingSearchResult:
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
        page.goto("https://www.housing.illinois.edu/cost")
        page.wait_for_load_state("domcontentloaded")
        page.wait_for_timeout(5000)
        print(f"  Loaded: {page.url}")

        # Dismiss cookie banner / overlays that block clicks
        for sel in [
            "#ilaCookieNoticeDiv button",
            "#ilaCookieModal button",
            "button:has-text('Accept')",
            "button:has-text('Got it')",
            "button:has-text('OK')",
        ]:
            try:
                btn = page.locator(sel).first
                if btn.is_visible(timeout=2000):
                    btn.evaluate("el => el.click()")
                    page.wait_for_timeout(500)
            except Exception:
                pass
        # Also remove overlay elements via JS to ensure nothing blocks clicks
        page.evaluate("""() => {
            for (const sel of ['#ilaCookieModal', '#ilaCookieNoticeDiv', 'skip-to-content']) {
                const el = document.querySelector(sel);
                if (el) el.remove();
            }
        }""")

        # STEP 1: Open the "New Resident Rates" accordion
        # It's the first <details> inside #paragraph--2269
        print("\nSTEP 1: Opening 'New Resident Rates' section ...")
        details_section = page.locator("#paragraph--2269 details").first
        summary = details_section.locator("summary").first
        is_open = details_section.get_attribute("open")
        if is_open is None:
            summary.evaluate("el => el.click()")
            page.wait_for_timeout(1000)
        print("  Expanded 'New Resident Rates 2026 – 2027'")

        # STEP 2: Extract all undergraduate hall tables using JS
        # Each table has header rows with room type column names,
        # and data rows with meal plan label + prices per column.
        print(f"\nSTEP 2: Extracting halls matching meal plan='{request.meal_plan}', room type='{request.room_type}' ...")

        raw_results = page.evaluate("""(args) => {
            const { mealPlan, roomType } = args;
            const results = [];
            const container = document.querySelector('#paragraph--2269 details');
            if (!container) return results;

            const tables = container.querySelectorAll('table');
            for (const table of tables) {
                // Determine hall name from caption, merged header cell, or preceding element
                let hallName = '';
                const caption = table.querySelector('caption');
                if (caption) {
                    hallName = caption.textContent.trim();
                }
                if (!hallName) {
                    const firstRow = table.querySelector('tr');
                    if (firstRow) {
                        const firstCell = firstRow.querySelector('th, td');
                        if (firstCell && firstCell.colSpan > 1) {
                            hallName = firstCell.textContent.trim();
                        }
                    }
                }
                if (!hallName) {
                    let prev = table.previousElementSibling;
                    while (prev && !hallName) {
                        if (prev.tagName.match(/^H[1-6]$/) || prev.tagName === 'P' || prev.tagName === 'STRONG') {
                            hallName = prev.textContent.trim();
                        }
                        prev = prev.previousElementSibling;
                    }
                }
                if (!hallName) continue;

                // Find the column index for the exact room type
                let singleColIndex = -1;
                const headerRows = table.querySelectorAll('thead tr, tr');
                for (const headerRow of headerRows) {
                    const cells = headerRow.querySelectorAll('th, td');
                    for (let i = 0; i < cells.length; i++) {
                        const cellText = cells[i].textContent.trim();
                        if (cellText === roomType) {
                            singleColIndex = i;
                            break;
                        }
                    }
                    if (singleColIndex >= 0) break;
                }
                if (singleColIndex < 0) continue;

                // Find the meal plan row and extract the price at singleColIndex
                const rows = table.querySelectorAll('tr');
                for (const row of rows) {
                    const cells = row.querySelectorAll('th, td');
                    if (cells.length === 0) continue;
                    const rowLabel = cells[0].textContent.trim();
                    if (rowLabel === mealPlan) {
                        if (singleColIndex < cells.length) {
                            const priceText = cells[singleColIndex].textContent.trim();
                            const priceMatch = priceText.match(/\\$([\\d,]+)/);
                            if (priceMatch) {
                                const price = parseInt(priceMatch[1].replace(/,/g, ''), 10);
                                results.push({
                                    name: hallName,
                                    price: price,
                                    priceText: priceText,
                                });
                            }
                        }
                        break;
                    }
                }
            }
            return results;
        }""", {"mealPlan": request.meal_plan, "roomType": request.room_type})

        print(f"\n  Found {len(raw_results)} halls with '{request.room_type}' column:")
        for i, h in enumerate(raw_results, 1):
            print(f"    {i}. {h['name']} — ${h['price']:,}")

        # STEP 3: Filter by price range
        print(f"\nSTEP 3: Filtering to range (${request.price_min:,} – ${request.price_max:,}) ...")
        for h in raw_results:
            if request.price_min < h["price"] < request.price_max:
                halls.append(HallPricing(
                    hall_name=h["name"],
                    meal_plan=request.meal_plan,
                    room_type=request.room_type,
                    price=h["price"],
                ))

        print(f"\n  {len(halls)} halls in price range:")
        for i, h in enumerate(halls, 1):
            print(f"    {i}. {h.hall_name} — ${h.price:,}")

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
        price_min=request.price_min,
        price_max=request.price_max,
    )


def test_search_housing_cost():
    """Test: search for Single rooms with 'Room & 12 Classic Meals + 15 Dining Dollars',
    price range ($15,000 – $17,000)."""
    request = HousingSearchRequest(
        meal_plan="Room & 12 Classic Meals + 15 Dining Dollars",
        room_type="Double",
        price_min=15000,
        price_max=17000,
    )
    with sync_playwright() as pw:
        result = search_housing_cost(pw, request)

    print(f"\n{'='*60}")
    print(f"  Results: {len(result.halls)} halls")
    print(f"  Meal plan: {result.meal_plan}")
    print(f"  Room type: {result.room_type}")
    print(f"  Price range: ${result.price_min:,} – ${result.price_max:,}")
    print(f"{'='*60}")
    for i, h in enumerate(result.halls, 1):
        print(f"  {i}. {h.hall_name} — ${h.price:,}")
    return result


if __name__ == "__main__":
    test_search_housing_cost()
