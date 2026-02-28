/**
 * Focused probe: test different strategies for setting the price filter on apartments.com
 *
 * Strategy A: Full keyboard event simulation per character inside evaluate()
 * Strategy B: Click the predefined LI option items in the dropdown
 * Strategy C: Use stagehand.act() with dropdown already open (AI-assisted)
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

  // Navigate to Austin TX results
  console.log("Loading apartments.com/austin-tx/...");
  await page.goto("https://www.apartments.com/austin-tx/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);

  // Dismiss popups
  await page.evaluate(`(() => {
    const ot = document.querySelector('#onetrust-accept-btn-handler');
    if (ot) ot.click();
  })()`);
  await page.waitForTimeout(1000);

  // ── STRATEGY A: Full keyboard event simulation in evaluate ─────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  STRATEGY A: Keyboard event sim in evaluate()");
  console.log("═══════════════════════════════════════════════════");

  // Open dropdown
  await page.evaluate(`document.querySelector('#rentRangeLink').click()`);
  await page.waitForTimeout(1500);

  // Type into min-input with full keyboard event sequence per character
  const resultA = await page.evaluate(`(() => {
    function typeInto(input, text) {
      // Focus the input
      input.focus();
      input.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
      input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));

      // Select all and delete existing text
      input.setSelectionRange(0, input.value.length);
      if (input.value.length > 0) {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true }));
        input.dispatchEvent(new InputEvent('beforeinput', { inputType: 'deleteContentBackward', bubbles: true, cancelable: true }));
        input.value = '';
        input.dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', code: 'Backspace', keyCode: 8, which: 8, bubbles: true }));
      }

      // Type each character with full event chain
      for (const char of text) {
        const charCode = char.charCodeAt(0);
        const code = 'Digit' + char;

        // keydown
        input.dispatchEvent(new KeyboardEvent('keydown', {
          key: char, code, keyCode: charCode, charCode: 0, which: charCode,
          bubbles: true, cancelable: true
        }));

        // keypress
        input.dispatchEvent(new KeyboardEvent('keypress', {
          key: char, code, keyCode: charCode, charCode, which: charCode,
          bubbles: true, cancelable: true
        }));

        // beforeinput
        input.dispatchEvent(new InputEvent('beforeinput', {
          data: char, inputType: 'insertText',
          bubbles: true, cancelable: true
        }));

        // Actually update the value
        input.value += char;

        // input event
        input.dispatchEvent(new InputEvent('input', {
          data: char, inputType: 'insertText',
          bubbles: true
        }));

        // keyup
        input.dispatchEvent(new KeyboardEvent('keyup', {
          key: char, code, keyCode: charCode, charCode: 0, which: charCode,
          bubbles: true
        }));
      }

      // blur to trigger change
      input.dispatchEvent(new Event('change', { bubbles: true }));

      return input.value;
    }

    const min = document.querySelector('#min-input');
    const max = document.querySelector('#max-input');
    if (!min || !max) return { error: 'inputs not found' };

    const minVal = typeInto(min, '1000');

    // Brief delay hack - can't actually delay in sync evaluate, but let's
    // move focus to max
    const maxVal = typeInto(max, '2000');

    return { minVal, maxVal };
  })()`);
  console.log("  After typing:", JSON.stringify(resultA));
  await page.waitForTimeout(1000);

  // Check values persisted
  const verifyA = await page.evaluate(`(() => {
    const min = document.querySelector('#min-input');
    const max = document.querySelector('#max-input');
    return { minVal: min.value, maxVal: max.value };
  })()`);
  console.log("  Verify values:", JSON.stringify(verifyA));

  // Check if dropdown list items changed (might show filtered options)
  const listsA = await page.evaluate(`(() => {
    const minItems = [...document.querySelectorAll('.minRentOptions li, .js-minRentOptions li')].map(li => li.textContent.trim()).slice(0, 5);
    const maxItems = [...document.querySelectorAll('.maxRentOptions li, .js-maxRentOptions li, #maxRentOptions li')].map(li => li.textContent.trim()).slice(0, 5);
    return { minItems, maxItems };
  })()`);
  console.log("  Dropdown lists:", JSON.stringify(listsA));

  // Click Done
  await page.evaluate(`(() => {
    const btn = document.querySelector('.done-btn');
    if (btn) btn.click();
  })()`);
  await page.waitForTimeout(5000);

  const afterA = await page.evaluate(`(() => {
    const priceLink = document.querySelector('#rentRangeLink');
    return {
      priceLinkText: priceLink ? priceLink.textContent.trim() : 'N/A',
      url: window.location.href,
    };
  })()`);
  console.log("  After Done:", JSON.stringify(afterA));
  const strategyAWorked = afterA.priceLinkText !== 'Price' || afterA.url.includes('1000');
  console.log("  Strategy A worked:", strategyAWorked);

  // ── STRATEGY B: Click LI option items ──────────────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  STRATEGY B: Click LI options in dropdown");
  console.log("═══════════════════════════════════════════════════");

  // Reload to reset
  await page.goto("https://www.apartments.com/austin-tx/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  await page.evaluate(`(() => { const ot = document.querySelector('#onetrust-accept-btn-handler'); if (ot) ot.click(); })()`);
  await page.waitForTimeout(1000);

  // Open dropdown
  await page.evaluate(`document.querySelector('#rentRangeLink').click()`);
  await page.waitForTimeout(1500);

  // List all available min and max options
  const allOptions = await page.evaluate(`(() => {
    const minItems = [...document.querySelectorAll('.minRentOptions li, .js-minRentOptions li')].map(li => ({
      text: li.textContent.trim(),
      dataVal: li.getAttribute('data-value') || li.getAttribute('value') || '',
      classes: li.className,
      onclick: li.getAttribute('onclick') || '',
    }));
    const maxItems = [...document.querySelectorAll('.maxRentOptions li, .js-maxRentOptions li, #maxRentOptions li')].map(li => ({
      text: li.textContent.trim(),
      dataVal: li.getAttribute('data-value') || li.getAttribute('value') || '',
      classes: li.className,
      onclick: li.getAttribute('onclick') || '',
    }));
    return { minItems, maxItems };
  })()`);
  console.log("  Min options:", JSON.stringify(allOptions.minItems, null, 2));
  console.log("  Max options:", JSON.stringify(allOptions.maxItems, null, 2));

  // Try clicking "No Min" for min (the safest option)
  const minClicked = await page.evaluate(`(() => {
    // First click the min input to show min options
    const minInp = document.querySelector('#min-input');
    if (minInp) { minInp.focus(); minInp.click(); }

    const minItems = document.querySelectorAll('.minRentOptions li, .js-minRentOptions li');
    for (const li of minItems) {
      const text = li.textContent.trim();
      // Look for "No Min" or the first item
      if (text.toLowerCase().includes('no min') || text === 'No Min') {
        li.click();
        return { clicked: text };
      }
    }
    // Try clicking the second item (first real price option)
    if (minItems.length > 1) {
      minItems[1].click();
      return { clicked: minItems[1].textContent.trim(), index: 1 };
    }
    return { error: 'no min options' };
  })()`);
  console.log("  Min clicked:", JSON.stringify(minClicked));
  await page.waitForTimeout(500);

  // Now click a max option — look for $2,000
  const maxClicked = await page.evaluate(`(() => {
    // Click max input to show max options
    const maxInp = document.querySelector('#max-input');
    if (maxInp) { maxInp.focus(); maxInp.click(); }

    const maxItems = document.querySelectorAll('.maxRentOptions li, .js-maxRentOptions li, #maxRentOptions li');
    for (const li of maxItems) {
      const text = li.textContent.trim();
      if (text.includes('2,000') || text.includes('2000')) {
        li.click();
        return { clicked: text };
      }
    }
    // Fallback: click closest option
    for (const li of maxItems) {
      const text = li.textContent.trim();
      const numMatch = text.match(/[\\d,]+/);
      if (numMatch) {
        const val = parseInt(numMatch[0].replace(/,/g, ''));
        if (val >= 1800 && val <= 2200) {
          li.click();
          return { clicked: text, approx: true };
        }
      }
    }
    if (maxItems.length > 0) {
      maxItems[0].click();
      return { clicked: maxItems[0].textContent.trim(), index: 0 };
    }
    return { error: 'no max options' };
  })()`);
  console.log("  Max clicked:", JSON.stringify(maxClicked));
  await page.waitForTimeout(500);

  // Check input values after clicking LI items
  const afterLI = await page.evaluate(`(() => {
    const min = document.querySelector('#min-input');
    const max = document.querySelector('#max-input');
    return { minVal: min.value, maxVal: max.value };
  })()`);
  console.log("  Input values after LI clicks:", JSON.stringify(afterLI));

  // Click Done
  await page.evaluate(`(() => {
    const btn = document.querySelector('.done-btn');
    if (btn) btn.click();
  })()`);
  await page.waitForTimeout(5000);

  const afterB = await page.evaluate(`(() => {
    const priceLink = document.querySelector('#rentRangeLink');
    return {
      priceLinkText: priceLink ? priceLink.textContent.trim() : 'N/A',
      url: window.location.href,
    };
  })()`);
  console.log("  After Done:", JSON.stringify(afterB));
  const strategyBWorked = afterB.priceLinkText !== 'Price' || afterB.url.includes('2000');
  console.log("  Strategy B worked:", strategyBWorked);

  // ── STRATEGY C: Use stagehand.act() with dropdown open ─────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  STRATEGY C: stagehand.act() with dropdown open");
  console.log("═══════════════════════════════════════════════════");

  // Reload to reset
  await page.goto("https://www.apartments.com/austin-tx/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  await page.evaluate(`(() => { const ot = document.querySelector('#onetrust-accept-btn-handler'); if (ot) ot.click(); })()`);
  await page.waitForTimeout(1000);

  // Open dropdown via evaluate
  await page.evaluate(`document.querySelector('#rentRangeLink').click()`);
  await page.waitForTimeout(1500);
  console.log("  Dropdown opened via evaluate");

  // Now use AI to interact with the visible inputs
  try {
    console.log("  AI: Setting min price...");
    await stagehand.act("Click on the min price input field that says 'Min Price' and type 1000");
    await page.waitForTimeout(1000);
    console.log("  AI: Setting max price...");
    await stagehand.act("Click on the max price input field that says 'Max Price' and type 2000");
    await page.waitForTimeout(1000);

    // Check values
    const afterAI = await page.evaluate(`(() => {
      const min = document.querySelector('#min-input');
      const max = document.querySelector('#max-input');
      return { minVal: min ? min.value : 'N/A', maxVal: max ? max.value : 'N/A' };
    })()`);
    console.log("  Values after AI:", JSON.stringify(afterAI));

    console.log("  AI: Clicking Done...");
    await stagehand.act("Click the Done button to apply the price filter");
    await page.waitForTimeout(5000);

    const afterC = await page.evaluate(`(() => {
      const priceLink = document.querySelector('#rentRangeLink');
      return {
        priceLinkText: priceLink ? priceLink.textContent.trim() : 'N/A',
        url: window.location.href,
      };
    })()`);
    console.log("  After Done:", JSON.stringify(afterC));
    const strategyCWorked = afterC.priceLinkText !== 'Price' || afterC.url.includes('1000');
    console.log("  Strategy C worked:", strategyCWorked);
  } catch (e) {
    console.log("  Strategy C error:", e.message);
  }

  // ── STRATEGY D: observe+act for min/max inputs ─────────────────────────
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  STRATEGY D: observe+act pattern");
  console.log("═══════════════════════════════════════════════════");

  // Reload
  await page.goto("https://www.apartments.com/austin-tx/");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  await page.evaluate(`(() => { const ot = document.querySelector('#onetrust-accept-btn-handler'); if (ot) ot.click(); })()`);
  await page.waitForTimeout(1000);

  // Open dropdown
  await page.evaluate(`document.querySelector('#rentRangeLink').click()`);
  await page.waitForTimeout(1500);

  try {
    // observe the min input
    console.log("  Observing min input...");
    const minActions = await stagehand.observe("Find the minimum price input field with placeholder 'Min Price'");
    console.log("  Min actions:", JSON.stringify(minActions.map(a => ({ desc: a.description, selector: a.selector })).slice(0, 3)));

    if (minActions.length > 0) {
      console.log("  Acting on min input...");
      await stagehand.act(minActions[0]);
      await page.waitForTimeout(300);
      // Now type
      await page.keyPress("Control+a");
      await page.waitForTimeout(100);
      await page.type("1000", { delay: 80 });
      await page.waitForTimeout(500);
    }

    // observe the max input
    console.log("  Observing max input...");
    const maxActions = await stagehand.observe("Find the maximum price input field with placeholder 'Max Price'");
    console.log("  Max actions:", JSON.stringify(maxActions.map(a => ({ desc: a.description, selector: a.selector })).slice(0, 3)));

    if (maxActions.length > 0) {
      console.log("  Acting on max input...");
      await stagehand.act(maxActions[0]);
      await page.waitForTimeout(300);
      await page.keyPress("Control+a");
      await page.waitForTimeout(100);
      await page.type("2000", { delay: 80 });
      await page.waitForTimeout(500);
    }

    // Check values
    const afterOA = await page.evaluate(`(() => {
      const min = document.querySelector('#min-input');
      const max = document.querySelector('#max-input');
      return { minVal: min ? min.value : 'N/A', maxVal: max ? max.value : 'N/A' };
    })()`);
    console.log("  Values after observe+act:", JSON.stringify(afterOA));

    // Click done
    const doneActions = await stagehand.observe("Find the Done button in the price filter dropdown");
    if (doneActions.length > 0) {
      await stagehand.act(doneActions[0]);
    } else {
      await page.evaluate(`document.querySelector('.done-btn').click()`);
    }
    await page.waitForTimeout(5000);

    const afterD = await page.evaluate(`(() => {
      const priceLink = document.querySelector('#rentRangeLink');
      return {
        priceLinkText: priceLink ? priceLink.textContent.trim() : 'N/A',
        url: window.location.href,
      };
    })()`);
    console.log("  After Done:", JSON.stringify(afterD));
    const strategyDWorked = afterD.priceLinkText !== 'Price' || afterD.url.includes('1000');
    console.log("  Strategy D worked:", strategyDWorked);
  } catch (e) {
    console.log("  Strategy D error:", e.message);
  }

  console.log("\n═══════════════════════════════════════════════════");
  console.log("  SUMMARY");
  console.log("═══════════════════════════════════════════════════");

  await stagehand.close();
  console.log("Done!");
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
