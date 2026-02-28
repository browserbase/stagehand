/**
 * Probe: Inspect apartments.com homepage DOM to find the search bar selector.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { setupLLMClient } = require("../../stagehand-utils");
const path = require("path");
const os = require("os");

async function main() {
  const llmClient = setupLLMClient("hybrid");
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    llmClient,
    localBrowserLaunchOptions: {
      userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
      headless: false,
      viewport: { width: 1920, height: 1080 },
      args: ["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions"],
    },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];

  console.log("Loading apartments.com...");
  await page.goto("https://www.apartments.com");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  console.log("URL:", page.url);
  console.log("Title:", await page.title());

  // Dump all input elements
  const inputs = await page.evaluate(`(() => {
    const results = [];
    document.querySelectorAll('input, [role="searchbox"], [role="combobox"], [contenteditable]').forEach(el => {
      results.push({
        tag: el.tagName,
        id: el.id || '',
        name: el.name || '',
        type: el.type || '',
        placeholder: el.placeholder || '',
        class: el.className.substring(0, 100),
        visible: el.offsetParent !== null || el.getClientRects().length > 0,
        ariaLabel: el.getAttribute('aria-label') || '',
        role: el.getAttribute('role') || '',
      });
    });
    return results;
  })()`);
  console.log("\n=== INPUT ELEMENTS ===");
  inputs.forEach((inp, i) => {
    console.log(`  [${i}] <${inp.tag}> id="${inp.id}" name="${inp.name}" type="${inp.type}" placeholder="${inp.placeholder}" visible=${inp.visible} role="${inp.role}" aria="${inp.ariaLabel}" class="${inp.class}"`);
  });

  // Check for search-related elements
  const searchEls = await page.evaluate(`(() => {
    const results = [];
    const selectors = [
      '#heroSearchInput', '#quickSearchLookup', '#searchBarLookup',
      '#location-search', 'input[name="searchterm"]',
      '[data-testid*="search"]', '[class*="search"] input',
      '[class*="hero"] input', 'form input',
      '#searchForm input', '.searchWidget input',
    ];
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (el) {
        results.push({
          selector: sel,
          tag: el.tagName, id: el.id || '', type: el.type || '',
          placeholder: el.placeholder || '',
          visible: el.offsetParent !== null || el.getClientRects().length > 0,
          rect: el.getBoundingClientRect(),
        });
      }
    });
    return results;
  })()`);
  console.log("\n=== SEARCH-SPECIFIC SELECTORS ===");
  searchEls.forEach(s => {
    console.log(`  ${s.selector} → <${s.tag}> id="${s.id}" type="${s.type}" placeholder="${s.placeholder}" visible=${s.visible} rect=${JSON.stringify(s.rect)}`);
  });

  // Try stagehand.observe
  console.log("\n=== STAGEHAND OBSERVE ===");
  const actions1 = await stagehand.observe("Find the main search input on the homepage for entering a location like a city name");
  console.log("Observe (search input):", JSON.stringify(actions1.slice(0, 3), null, 2));

  const actions2 = await stagehand.observe("Find any text input or search box on the page");
  console.log("Observe (any input):", JSON.stringify(actions2.slice(0, 3), null, 2));

  await stagehand.close();
  console.log("\nDone!");
}
main().catch(e => { console.error(e.message); process.exit(1); });
