const { Stagehand } = require("@browserbasehq/stagehand");
const { setupLLMClient } = require("../../stagehand-utils");
const path = require("path");
const os = require("os");

/**
 * Quick probe to inspect apartments.com price filter DOM structure
 */
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
      args: ["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions", "--start-maximized", "--window-size=1920,1080"],
    },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];

  try {
    // Navigate directly to Austin TX results
    console.log("Loading search results...");
    await page.goto("https://www.apartments.com/austin-tx/");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(5000);
    console.log("URL:", page.url());

    // Probe 1: Dump the search bar container structure
    const searchBarInfo = await page.evaluate(`(() => {
      const sb = document.querySelector('#searchBar, #searchApp, #srp-smart-search');
      if (!sb) return { found: false };
      // List all inputs
      const inputs = Array.from(sb.querySelectorAll('input')).map(i => ({
        id: i.id, name: i.name, type: i.type, placeholder: i.placeholder,
        ariaLabel: i.getAttribute('aria-label'), className: i.className.substring(0,100),
        value: i.value,
      }));
      // List all buttons
      const buttons = Array.from(sb.querySelectorAll('button')).map(b => ({
        id: b.id, text: b.textContent.trim().substring(0,50), ariaLabel: b.getAttribute('aria-label'),
        className: b.className.substring(0,100),
      }));
      return { found: true, id: sb.id, inputs, buttons };
    })()`);
    console.log("\n=== SEARCH BAR ===");
    console.log(JSON.stringify(searchBarInfo, null, 2));

    // Probe 2: Dump the price filter container
    const priceFilterInfo = await page.evaluate(`(() => {
      const pf = document.querySelector('#rentMinMaxRangeControl');
      if (!pf) return { found: false, alternatives: 'none' };
      return {
        found: true,
        innerHTML: pf.innerHTML.substring(0, 2000),
        // List all child elements
        children: Array.from(pf.querySelectorAll('*')).map(el => ({
          tag: el.tagName, id: el.id, className: (el.className || '').toString().substring(0,80),
          role: el.getAttribute('role'), ariaLabel: el.getAttribute('aria-label'),
          text: el.textContent.trim().substring(0, 50),
          type: el.getAttribute('type'), name: el.getAttribute('name'),
        })).slice(0, 30),
      };
    })()`);
    console.log("\n=== PRICE FILTER (#rentMinMaxRangeControl) ===");
    console.log(JSON.stringify(priceFilterInfo, null, 2));

    // Probe 3: Click the Price link to open dropdown, then probe again
    console.log("\n=== Clicking Price link to open dropdown ===");
    const clickResult = await page.evaluate(`(() => {
      const link = document.querySelector('#rentMinMaxRangeControl a');
      if (!link) return { clicked: false };
      link.click();
      return { clicked: true, text: link.textContent.trim() };
    })()`);
    console.log("Click result:", JSON.stringify(clickResult));
    await page.waitForTimeout(2000);

    // Probe 4: After clicking, probe for new/visible elements
    const afterClickInfo = await page.evaluate(`(() => {
      // Check for dropdown/flyout that appeared
      const pf = document.querySelector('#rentMinMaxRangeControl');
      if (!pf) return { found: false };
      const allEls = Array.from(pf.querySelectorAll('*')).filter(el => {
        return el.offsetParent !== null || el.getClientRects().length > 0;
      });
      return {
        visibleCount: allEls.length,
        elements: allEls.map(el => ({
          tag: el.tagName, id: el.id,
          className: (el.className || '').toString().substring(0,80),
          role: el.getAttribute('role'),
          ariaLabel: el.getAttribute('aria-label'),
          text: el.textContent.trim().substring(0, 50),
          type: el.getAttribute('type'),
          name: el.getAttribute('name'),
          placeholder: el.getAttribute('placeholder'),
        })).slice(0, 40),
      };
    })()`);
    console.log("\n=== VISIBLE ELEMENTS AFTER CLICK ===");
    console.log(JSON.stringify(afterClickInfo, null, 2));

    // Probe 5: Look for any dropdown/select for min/max price outside #rentMinMaxRangeControl
    const globalPriceInputs = await page.evaluate(`(() => {
      // Search globally for price-related inputs
      const allInputs = document.querySelectorAll('input, select');
      const priceRelated = Array.from(allInputs).filter(el => {
        const txt = (el.id + ' ' + el.name + ' ' + el.className + ' ' + (el.getAttribute('aria-label') || '') + ' ' + (el.placeholder || '')).toLowerCase();
        return txt.includes('price') || txt.includes('rent') || txt.includes('min') || txt.includes('max');
      });
      return priceRelated.map(el => ({
        tag: el.tagName, id: el.id, name: el.name, type: el.type,
        className: (el.className || '').toString().substring(0,80),
        ariaLabel: el.getAttribute('aria-label'),
        placeholder: el.placeholder || '',
        value: el.value, visible: el.offsetParent !== null,
      }));
    })()`);
    console.log("\n=== GLOBAL PRICE-RELATED INPUTS ===");
    console.log(JSON.stringify(globalPriceInputs, null, 2));

    // Probe 6: Check listing card structure
    const cardInfo = await page.evaluate(`(() => {
      const cards = document.querySelectorAll('[data-listingid], article[data-pk], [class*="placard"]');
      if (cards.length === 0) return { found: false };
      const firstCard = cards[0];
      const allEls = Array.from(firstCard.querySelectorAll('*')).slice(0, 40);
      return {
        cardCount: cards.length,
        firstCardId: firstCard.getAttribute('data-listingid') || firstCard.getAttribute('data-pk') || '',
        firstCardTag: firstCard.tagName,
        firstCardClass: firstCard.className.toString().substring(0,100),
        elements: allEls.map(el => ({
          tag: el.tagName, className: (el.className || '').toString().substring(0,80),
          text: el.textContent.trim().substring(0,60),
          dataTest: el.getAttribute('data-test') || '',
        })),
      };
    })()`);
    console.log("\n=== LISTING CARDS ===");
    console.log(JSON.stringify(cardInfo, null, 2));

  } finally {
    await stagehand.close();
  }
}

main().then(() => { console.log("\nDone!"); process.exit(0); }).catch(e => { console.error("Error:", e.message); process.exit(1); });
