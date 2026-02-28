/**
 * Probe: Inspect apartments.com listing card DOM for price/beds selectors.
 * Uses Stagehand (better anti-detection) to navigate via search bar.
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
      args: ["--disable-blink-features=AutomationControlled", "--disable-infobars", "--disable-extensions"],
    },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];

  // Navigate via search
  await page.goto("https://www.apartments.com");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);

  // Search
  await stagehand.act("Click the search bar to start typing a location");
  await page.waitForTimeout(500);
  await page.type("Austin, TX", { delay: 80 });
  await page.waitForTimeout(2500);
  await stagehand.act("Click the first autocomplete suggestion for Austin, TX");
  await page.waitForLoadState("domcontentloaded");
  await page.waitForTimeout(5000);
  console.log("URL:", await page.evaluate("window.location.href"));

  // Inspect first 3 cards
  const cardInfo = await page.evaluate(`(() => {
    const cards = document.querySelectorAll('article.placard, [data-listingid]');
    const results = [];
    for (let i = 0; i < Math.min(3, cards.length); i++) {
      const card = cards[i];
      // Get all child elements with their classes and text
      const children = [];
      card.querySelectorAll('*').forEach(el => {
        const cls = el.className && typeof el.className === 'string' ? el.className : '';
        const text = el.textContent.trim().substring(0, 100);
        const tag = el.tagName.toLowerCase();
        if (text && (cls.includes('price') || cls.includes('pricing') || cls.includes('rent') ||
            cls.includes('bed') || cls.includes('bath') || cls.includes('unit') ||
            cls.includes('property-') || tag === 'p' || tag === 'span')) {
          children.push({ tag, cls: cls.substring(0, 120), text });
        }
      });
      // Also get all <p> and <span> children directly
      const pSpans = [];
      card.querySelectorAll('p, span, div.price-range, div.property-pricing').forEach(el => {
        const cls = el.className && typeof el.className === 'string' ? el.className : '';
        const text = el.textContent.trim().substring(0, 100);
        if (text) pSpans.push({ tag: el.tagName.toLowerCase(), cls: cls.substring(0, 120), text });
      });
      results.push({
        outerHTMLSnippet: card.outerHTML.substring(0, 1500),
        innerText: card.textContent.trim().substring(0, 300),
        matchingChildren: children.slice(0, 20),
        allPSpans: pSpans.slice(0, 15),
      });
    }
    return { totalCards: cards.length, cards: results };
  })()`);

  console.log("Total cards:", cardInfo.totalCards);
  for (let i = 0; i < cardInfo.cards.length; i++) {
    console.log(`\n${"=".repeat(60)}\nCARD ${i}:`);
    console.log("--- Inner text ---");
    console.log(cardInfo.cards[i].innerText);
    console.log("\n--- Matching children (price/bed/rent/property-*) ---");
    cardInfo.cards[i].matchingChildren.forEach(c => {
      console.log(`  <${c.tag}> class="${c.cls}" → "${c.text}"`);
    });
    console.log("\n--- All <p>/<span> ---");
    cardInfo.cards[i].allPSpans.forEach(c => {
      console.log(`  <${c.tag}> class="${c.cls}" → "${c.text}"`);
    });
    console.log("\n--- HTML snippet ---");
    console.log(cardInfo.cards[i].outerHTMLSnippet.substring(0, 800));
  }

  await stagehand.close();
  console.log("\nDone!");
}
main().catch(e => { console.error(e.message); process.exit(1); });
