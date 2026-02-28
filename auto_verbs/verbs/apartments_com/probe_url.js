/**
 * Quick probe: test apartments.com URL patterns for price filtering.
 * Tries navigating to price-filtered URLs and checks if they work.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { setupLLMClient } = require("../../stagehand-utils");
const path = require("path");
const os = require("os");

async function main() {
  const llmClient = setupLLMClient("hybrid");
  const stagehand = new Stagehand({
    env: "LOCAL", verbose: 0, llmClient,
    localBrowserLaunchOptions: {
      userDataDir: path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"),
      headless: false,
      viewport: { width: 1920, height: 1080 },
      args: ["--disable-blink-features=AutomationControlled", "--disable-infobars"],
    },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];

  // Test URL patterns for $1000-$2000 in Austin TX
  const patterns = [
    "https://www.apartments.com/austin-tx/min-1000-max-2000/",
    "https://www.apartments.com/austin-tx/?min=1000&max=2000",
    "https://www.apartments.com/austin-tx/1000-to-2000/",
    "https://www.apartments.com/austin-tx/?min_rent=1000&max_rent=2000",
  ];

  for (const url of patterns) {
    console.log(`\n🔗 Trying: ${url}`);
    try {
      await page.goto(url);
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(3000);
      const finalUrl = page.url();
      console.log(`   Final URL: ${finalUrl}`);
      
      // Check if price filter is reflected in the page
      const filterState = await page.evaluate(`(() => {
        const minInp = document.querySelector('#min-input');
        const maxInp = document.querySelector('#max-input');
        const priceLink = document.querySelector('#rentRangeLink');
        const priceLinkText = priceLink ? priceLink.textContent.trim() : 'N/A';
        return {
          minValue: minInp ? minInp.value : 'N/A',
          maxValue: maxInp ? maxInp.value : 'N/A',
          priceLinkText,
          urlHasPrice: finalUrl.includes('1000') || finalUrl.includes('2000'),
          title: document.title,
        };
      })()`);
      console.log(`   Filter state:`, JSON.stringify(filterState, null, 2));
      
      if (filterState.urlHasPrice || filterState.minValue || filterState.maxValue) {
        console.log(`   ✅ This URL pattern works!`);
      } else {
        console.log(`   ❌ No price filter detected`);
      }
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }
  }

  // Also test: navigate to base URL, then use DOM to apply filter with nativeInputValueSetter
  console.log("\n\n🔧 Testing DOM-based filter with nativeInputValueSetter...");
  await page.goto("https://www.apartments.com/austin-tx/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  
  // Dismiss popups
  await page.evaluate(`(() => {
    const ot = document.querySelector('#onetrust-accept-btn-handler');
    if (ot) ot.click();
  })()`);
  await page.waitForTimeout(1000);
  
  // Open dropdown
  const opened = await page.evaluate(`(() => {
    const link = document.querySelector('#rentRangeLink');
    if (link) { link.click(); return link.textContent.trim(); }
    return false;
  })()`);
  console.log(`   Dropdown opened: ${opened}`);
  await page.waitForTimeout(1500);

  // Check dropdown state
  const ddState = await page.evaluate(`(() => {
    const min = document.querySelector('#min-input');
    const max = document.querySelector('#max-input');
    const done = document.querySelector('.done-btn');
    return {
      minVisible: min ? (min.offsetParent !== null) : false,
      maxVisible: max ? (max.offsetParent !== null) : false,
      doneVisible: done ? (done.offsetParent !== null) : false,
      minType: min ? min.type : 'N/A',
      minPlaceholder: min ? min.placeholder : 'N/A',
    };
  })()`);
  console.log(`   Dropdown state:`, JSON.stringify(ddState, null, 2));

  // Method A: nativeInputValueSetter
  const setResult = await page.evaluate(`(() => {
    try {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      const min = document.querySelector('#min-input');
      const max = document.querySelector('#max-input');
      
      // Set min
      min.focus();
      setter.call(min, '1000');
      min.dispatchEvent(new Event('input', { bubbles: true }));
      min.dispatchEvent(new Event('change', { bubbles: true }));
      min.dispatchEvent(new KeyboardEvent('keyup', { key: '0', bubbles: true }));
      
      // Set max
      max.focus();
      setter.call(max, '2000');
      max.dispatchEvent(new Event('input', { bubbles: true }));
      max.dispatchEvent(new Event('change', { bubbles: true }));
      max.dispatchEvent(new KeyboardEvent('keyup', { key: '0', bubbles: true }));
      
      return { minVal: min.value, maxVal: max.value };
    } catch(e) {
      return { error: e.message };
    }
  })()`);
  console.log(`   nativeInputValueSetter result:`, JSON.stringify(setResult));
  await page.waitForTimeout(500);

  // Verify values are still set
  const verify1 = await page.evaluate(`(() => {
    const min = document.querySelector('#min-input');
    const max = document.querySelector('#max-input');
    return { minVal: min.value, maxVal: max.value };
  })()`);
  console.log(`   Values after setter:`, JSON.stringify(verify1));

  // Click Done
  const doneClicked = await page.evaluate(`(() => {
    const btn = document.querySelector('.done-btn');
    if (btn) { btn.click(); return true; }
    return false;
  })()`);
  console.log(`   Done clicked: ${doneClicked}`);
  await page.waitForTimeout(5000);
  
  const finalUrl = page.url();
  console.log(`   Final URL: ${finalUrl}`);
  
  // Check if filter took effect
  const afterFilter = await page.evaluate(`(() => {
    const priceLink = document.querySelector('#rentRangeLink');
    return {
      priceLinkText: priceLink ? priceLink.textContent.trim() : 'N/A',
      url: window.location.href,
    };
  })()`);
  console.log(`   After filter:`, JSON.stringify(afterFilter));

  await stagehand.close();
  console.log("\nDone!");
}

main().catch(e => { console.error(e); process.exit(1); });
