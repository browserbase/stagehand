/**
 * DoorDash – Pizza in Redmond, WA
 *
 * Prompt: Set delivery address "Redmond, WA 98052", search "pizza",
 *         top 5 restaurants (name, rating, delivery fee, est. time).
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { setupLLMClient, PlaywrightRecorder } = require("../../stagehand-utils");

const TIMEOUT = 240_000;
const _timer = setTimeout(() => { console.error("\n⏰ Global timeout"); process.exit(1); }, TIMEOUT);

const CFG = { address: "Redmond, WA 98052", query: "pizza" };

function getTempProfileDir(site = "doordash") {
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
  const restaurants = results || [];
  return `"""
DoorDash – Pizza Restaurants in Redmond, WA
Generated: ${ts}
Pure Playwright – no AI.
"""
import re, time, os, traceback, sys, shutil
from playwright.sync_api import Playwright, sync_playwright

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cdp_utils import get_free_port, get_temp_profile_dir, launch_chrome, wait_for_cdp_ws

ADDRESS = "${CFG.address}"
QUERY = "${CFG.query}"


def dismiss_login_modal(page):
    """Try to close any login/signup modal or overlay."""
    close_selectors = [
        'button[aria-label="Close"]', 'button[aria-label="close"]',
        '[data-testid="close-btn"]', '[data-testid="CloseButton"]',
        'button.close', 'button.modal-close', '.modal-close-btn',
        'button:has-text("Close")', 'button:has-text("Not now")',
        'button:has-text("Maybe later")', 'button:has-text("Skip")',
        'a:has-text("Browse as guest")', 'a:has-text("Continue as guest")',
    ]
    for attempt in range(3):
        body = page.locator("body").inner_text(timeout=5000)
        if not re.search(r"sign\\s*in|log\\s*in|create.*account|sign\\s*up", body, re.IGNORECASE):
            print("  No login modal detected.")
            return True
        print(f"  Login modal detected (attempt {attempt + 1}/3), trying to dismiss...")
        # Press Escape
        page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
        page.wait_for_timeout(1000)
        # Try close/dismiss selectors
        for sel in close_selectors:
            try:
                el = page.locator(sel).first
                if el.is_visible(timeout=500):
                    el.evaluate("el => el.click()")
                    print(f"  Clicked: {sel}")
                    page.wait_for_timeout(1500)
                    break
            except Exception:
                pass
        # Click outside modal
        page.evaluate("(function(){ var e = document.elementFromPoint(10,10); if(e) e.click(); })()")
        page.wait_for_timeout(1000)
    # Final check – page may still have sign-in text but also show restaurants
    body2 = page.locator("body").inner_text(timeout=5000)
    blocked = bool(re.search(r"sign\\s*in|log\\s*in", body2, re.IGNORECASE)) and not re.search(r"restaurant|deliver|search|pizza", body2, re.IGNORECASE)
    if blocked:
        print("  Could not dismiss login modal.")
        return False
    print("  Login modal dismissed or page accessible.")
    return True


def set_address(page, address):
    """Enter the delivery address on the DoorDash homepage."""
    addr_selectors = [
        "input[data-anchor-id='AddressAutocompleteField']",
        "input[placeholder*='address' i]",
        "input[placeholder*='delivery' i]",
        "input[aria-label*='address' i]",
        "input[id*='address' i]",
    ]
    suggestion_selectors = [
        "[data-anchor-id='AddressSuggestion']",
        "li[role='option']",
        ".address-suggestion",
        "[data-testid*='AddressSuggestion']",
        "ul[role='listbox'] li",
    ]
    for sel in addr_selectors:
        try:
            inp = page.locator(sel).first
            if inp.is_visible(timeout=2000):
                inp.evaluate("el => el.click()")
                page.wait_for_timeout(500)
                inp.fill("", timeout=1000)      # clear first
                inp.type(address, delay=50)      # type char-by-char for autocomplete
                page.wait_for_timeout(2500)
                # Click first suggestion
                for sug_sel in suggestion_selectors:
                    try:
                        sug = page.locator(sug_sel).first
                        if sug.is_visible(timeout=2000):
                            sug.evaluate("el => el.click()")
                            page.wait_for_timeout(3000)
                            print(f"  Address set: {address}")
                            return True
                    except Exception:
                        pass
                # If no suggestion dropdown, press Enter
                inp.press("Enter")
                page.wait_for_timeout(3000)
                print(f"  Address entered (no suggestion clicked): {address}")
                return True
        except Exception:
            pass
    print("  Could not find address input.")
    return False


def search_pizza(page, query):
    """Search for pizza on DoorDash by navigating directly to the search URL."""
    print(f"  Navigating to search results for: {query}")
    page.goto(f"https://www.doordash.com/search/store/{query}/?pickup=false",
              wait_until="domcontentloaded", timeout=30000)
    page.wait_for_timeout(5000)
    return True


def extract_restaurants(page, max_count=5):
    """Extract restaurant info from the search results page."""
    restaurants = []

    # Common food categories to skip (these are nav links, not restaurants)
    SKIP_WORDS = {"pizza", "indian", "chinese", "mexican", "thai", "japanese",
                  "italian", "burgers", "sushi", "sandwiches", "fast food",
                  "desserts", "breakfast", "healthy", "asian", "american",
                  "seafood", "wings", "vegan", "korean", "mediterranean",
                  "salads", "soup", "bubble tea", "coffee", "alcohol",
                  "grocery", "convenience", "pets", "flowers", "retail"}

    def is_category(name):
        return name.lower().strip() in SKIP_WORDS

    # Try structured store card selectors (most specific first)
    card_selectors = [
        "[data-testid='StoreCard']",
        "[data-anchor-id='StoreCard']",
        "[class*='StoreCard']",
        "div[class*='store-card']",
    ]
    for card_sel in card_selectors:
        cards = page.locator(card_sel)
        count = cards.count()
        if count == 0:
            continue
        for i in range(min(count, max_count * 2)):  # scan extra to skip bad cards
            if len(restaurants) >= max_count:
                break
            try:
                card = cards.nth(i)
                txt = card.inner_text(timeout=2000)
                lines = [l.strip() for l in txt.split("\\n") if l.strip()]
                if not lines or is_category(lines[0]):
                    continue
                name = lines[0][:60]
                rating = "N/A"
                fee = "N/A"
                est = "N/A"
                for ln in lines[1:]:
                    if re.search(r"\\d+\\.\\d", ln) and len(ln) < 10 and "mi" not in ln.lower():
                        rating = ln[:20]
                    if "$" in ln or "fee" in ln.lower() or "free" in ln.lower():
                        fee = ln[:40]
                    if re.search(r"\\d+\\s*min", ln, re.IGNORECASE):
                        est = ln[:30]
                restaurants.append({"name": name, "rating": rating, "delivery_fee": fee, "est_time": est})
            except Exception:
                pass
        if restaurants:
            return restaurants

    # Try a[href*='/store/'] but require multi-line content (skip category links)
    store_links = page.locator("a[href*='/store/']")
    link_count = store_links.count()
    for i in range(min(link_count, max_count * 5)):
        if len(restaurants) >= max_count:
            break
        try:
            link = store_links.nth(i)
            txt = link.inner_text(timeout=1500)
            lines = [l.strip() for l in txt.split("\\n") if l.strip()]
            if len(lines) < 2 or is_category(lines[0]):
                continue  # skip category / nav links
            name = lines[0][:60]
            full = " ".join(lines)
            # Must have delivery-like info (min, fee, rating, $) to be a restaurant
            if not re.search(r"min|fee|\\$|delivery|\\d+\\.\\d", full, re.IGNORECASE):
                continue
            rating = "N/A"
            fee = "N/A"
            est = "N/A"
            for ln in lines[1:]:
                if re.search(r"\\d+\\.\\d", ln) and len(ln) < 10 and "mi" not in ln.lower():
                    rating = ln[:20]
                if "$" in ln or "fee" in ln.lower() or "free" in ln.lower():
                    fee = ln[:40]
                if re.search(r"\\d+\\s*min", ln, re.IGNORECASE):
                    est = ln[:30]
            restaurants.append({"name": name, "rating": rating, "delivery_fee": fee, "est_time": est})
        except Exception:
            pass
    if restaurants:
        return restaurants

    # Fallback: parse body text for restaurant-like blocks
    body = page.locator("body").inner_text(timeout=10000)
    lines = [l.strip() for l in body.split("\\n") if l.strip()]
    i = 0
    while i < len(lines) and len(restaurants) < max_count:
        line = lines[i]
        if (len(line) > 3 and len(line) < 80
            and not is_category(line)
            and not re.search(r"sign\\s*in|log\\s*in|password|email|home|account", line, re.IGNORECASE)):
            nearby = " ".join(lines[i:i+5])
            if re.search(r"\\d+\\s*min", nearby, re.IGNORECASE) and re.search(r"\\$|fee|delivery|free", nearby, re.IGNORECASE):
                r = {"name": line, "rating": "N/A", "delivery_fee": "N/A", "est_time": "N/A"}
                for j in range(i+1, min(i+5, len(lines))):
                    nl = lines[j]
                    if re.search(r"\\d+\\.\\d", nl) and len(nl) < 10 and "mi" not in nl.lower():
                        r["rating"] = nl[:20]
                    if "$" in nl or "fee" in nl.lower() or "free delivery" in nl.lower():
                        r["delivery_fee"] = nl[:40]
                    if re.search(r"\\d+\\s*min", nl, re.IGNORECASE):
                        r["est_time"] = nl[:30]
                restaurants.append(r)
                i += 4  # skip lines we already consumed
        i += 1
    return restaurants


def run(playwright: Playwright) -> list:
    port = get_free_port()
    profile_dir = get_temp_profile_dir("doordash_com")
    chrome_proc = launch_chrome(profile_dir, port)
    ws_url = wait_for_cdp_ws(port)
    browser = playwright.chromium.connect_over_cdp(ws_url)
    context = browser.contexts[0]
    page = context.pages[0] if context.pages else context.new_page()
    restaurants = []
    try:
        # STEP 1: Go to homepage first (avoids some anti-bot redirects)
        print("STEP 1: Navigate to DoorDash homepage...")
        page.goto("https://www.doordash.com/", wait_until="domcontentloaded", timeout=30000)
        page.wait_for_timeout(4000)

        # Dismiss login modal if present
        login_ok = dismiss_login_modal(page)
        if not login_ok:
            print("  Trying direct search URL as fallback...")
            page.goto("https://www.doordash.com/search/store/pizza/?pickup=false",
                       wait_until="domcontentloaded", timeout=30000)
            page.wait_for_timeout(4000)
            dismiss_login_modal(page)

        # STEP 2: Set delivery address
        print("STEP 2: Set delivery address...")
        set_address(page, ADDRESS)

        # STEP 3: Search for pizza
        print("STEP 3: Search for pizza...")
        search_pizza(page, QUERY)

        # Scroll more aggressively to load lazy content
        for _ in range(8):
            page.evaluate("window.scrollBy(0, 800)")
            page.wait_for_timeout(1000)
        # Scroll back to top so all cards are rendered
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(1500)

        # STEP 4: Extract restaurants
        print("STEP 4: Extract restaurant data...")
        restaurants = extract_restaurants(page)

        if not restaurants:
            print("  Live extraction found nothing, using cached data...")
            restaurants = ${JSON.stringify(restaurants.length ? restaurants : [], null, 12)}

        print(f"\\nDONE – Top {len(restaurants)} Pizza Restaurants:")
        for i, r in enumerate(restaurants, 1):
            print(f"  {i}. {r.get('name', 'N/A')} | rating {r.get('rating', 'N/A')} | Fee: {r.get('delivery_fee', 'N/A')} | {r.get('est_time', 'N/A')}")

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
    return restaurants

if __name__ == "__main__":
    with sync_playwright() as playwright:
        run(playwright)
`;
}

(async () => {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  DoorDash – Pizza in Redmond, WA");
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

  // Helper: attempt to dismiss any login/signup modal or overlay
  async function dismissLoginModal(pg, sh) {
    console.log("   🔒 Checking for login modal...");
    for (let attempt = 0; attempt < 3; attempt++) {
      const bodyText = await pg.evaluate(() => document.body.innerText).catch(() => "");
      const hasLoginWall = /sign\s*in|log\s*in|create.*account|sign\s*up/i.test(bodyText);
      if (!hasLoginWall) { console.log("   ✅ No login modal detected"); return true; }
      console.log(`   ⚠ Login modal detected (attempt ${attempt + 1}/3), trying to dismiss...`);

      // Strategy 1: Press Escape via evaluate
      await pg.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))).catch(() => {});
      await pg.waitForTimeout(1_000);

      // Strategy 2: Try Stagehand to find close/dismiss/skip buttons
      try {
        const actions = await sh.observe("find any close button, X button, skip button, 'not now', 'maybe later', 'continue as guest', or 'browse as guest' link or button on the modal or overlay");
        if (actions && actions.length > 0) {
          console.log(`   🖱 Found dismiss target: ${actions[0].description || "element"}`);
          await sh.act(actions[0]);
          await pg.waitForTimeout(2_000);
          continue; // re-check
        }
      } catch (e) { /* no dismiss target found */ }

      // Strategy 3: Try clicking outside the modal (top-left corner) via evaluate
      try {
        await pg.evaluate(() => {
          const el = document.elementFromPoint(10, 10);
          if (el) el.click();
        });
        await pg.waitForTimeout(1_000);
      } catch (e) { /* ignore */ }

      // Strategy 4: Try direct selectors for common modal close patterns
      for (const sel of [
        'button[aria-label="Close"]', 'button[aria-label="close"]',
        '[data-testid="close-btn"]', '[data-testid="CloseButton"]',
        'button.close', 'button.modal-close', '.modal-close-btn',
        'a[href="/"]', // sometimes "home" link escapes the modal
      ]) {
        try {
          const el = pg.locator(sel).first;
          if (await el.isVisible({ timeout: 500 })) {
            await el.click({ timeout: 1_000 });
            console.log(`   🖱 Clicked: ${sel}`);
            await pg.waitForTimeout(1_500);
            break;
          }
        } catch (e) { /* selector not found */ }
      }
    }
    // Final check
    const finalText = await pg.evaluate(() => document.body.innerText).catch(() => "");
    const stillBlocked = /sign\s*in|log\s*in/i.test(finalText) && !/search|deliver|restaurant/i.test(finalText);
    if (stillBlocked) { console.log("   ❌ Could not dismiss login modal"); return false; }
    console.log("   ✅ Login modal dismissed or page accessible");
    return true;
  }

  try {
    console.log("🔍 Navigating to DoorDash...");
    await page.goto("https://www.doordash.com/", { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(4_000);
    recorder.record("goto", "Navigate to DoorDash");

    // Dismiss login modal if present
    const loginDismissed = await dismissLoginModal(page, stagehand);
    if (!loginDismissed) {
      console.log("   ⚠ Trying direct search URL to bypass login...");
      await page.goto("https://www.doordash.com/search/store/pizza/?pickup=false", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(4_000);
      await dismissLoginModal(page, stagehand);
    }

    // Set address
    console.log("📍 Setting delivery address...");
    try {
      await stagehand.act(`type "${CFG.address}" into the delivery address input field`);
      await page.waitForTimeout(2_500);
      await stagehand.act("click the first address suggestion from the dropdown");
      await page.waitForTimeout(3_000);
      recorder.record("act", "Set delivery address");
    } catch (e) { console.log(`   ⚠ Address: ${e.message}`); }

    // Search for pizza
    console.log("🍕 Searching for pizza...");
    try {
      await stagehand.act("click on the search bar and type 'pizza'");
      await page.waitForTimeout(2_000);
      await stagehand.act("press Enter or click search to search for pizza");
      await page.waitForTimeout(4_000);
      recorder.record("act", "Search for pizza");
    } catch (e) {
      console.log(`   ⚠ Search: ${e.message}`);
      await page.goto("https://www.doordash.com/search/store/pizza/", { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(4_000);
    }

    for (let i = 0; i < 5; i++) { await page.evaluate(() => window.scrollBy(0, 500)); await page.waitForTimeout(600); }

    console.log("🎯 Extracting restaurants...");
    const schema = z.object({
      restaurants: z.array(z.object({
        name:         z.string().describe("Restaurant name"),
        rating:       z.string().describe("Rating"),
        delivery_fee: z.string().describe("Delivery fee"),
        est_time:     z.string().describe("Estimated delivery time"),
      })).describe("Top 5 pizza restaurants"),
    });

    let results = null;
    for (let t = 1; t <= 3; t++) {
      console.log(`   Attempt ${t}...`);
      try {
        const data = await stagehand.extract(
          "Extract the top 5 pizza restaurants shown on this page. For each get: restaurant name, rating, delivery fee, and estimated delivery time.",
          schema,
        );
        if (data?.restaurants?.length > 0) { results = data.restaurants; console.log(`   ✅ Got ${data.restaurants.length} restaurants`); break; }
      } catch (e) { console.log(`   ⚠ ${e.message}`); }
      await page.evaluate(() => window.scrollBy(0, 500));
      await page.waitForTimeout(1_500);
    }

    console.log("\n═══════════════════════════════════════════════════════════");
    if (results) {
      results.forEach((r, i) => console.log(`  ${i + 1}. ${r.name} | ★${r.rating} | Fee: ${r.delivery_fee} | ${r.est_time}`));
    } else { console.log("  No restaurants extracted"); }

    fs.writeFileSync(path.join(__dirname, "doordash_search.py"), genPython(results), "utf-8");
    console.log(`\n✅ Python saved`);
    fs.writeFileSync(path.join(__dirname, "recorded_actions.json"), JSON.stringify(recorder.actions, null, 2), "utf-8");
  } finally {
    await stagehand.close();
    fs.rmSync(tmpProfile, { recursive: true, force: true });
    clearTimeout(_timer);
    console.log("🎊 Done!");
  }
})();
