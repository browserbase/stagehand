/**
 * Exploration script: use extractAriaScopeForXPath to discover stable
 * locators for Ticketmaster event cards.
 * Run from auto_verbs/: node _explore_tm.js
 */
const { chromium } = require("playwright");
const path = require("path");
const os = require("os");
const { extractAriaScopeForXPath } = require(path.join(__dirname, "../auto_verbs/stagehand-utils.js"));

const USER_DATA_DIR = path.join(
  os.homedir(),
  "AppData/Local/Google/Chrome/User Data/Default"
);

(async () => {
  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    channel: "chrome",
    headless: false,
    args: ["--disable-blink-features=AutomationControlled"],
  });
  const page = context.pages()[0] || (await context.newPage());

  await page.goto(
    "https://www.ticketmaster.com/search?q=concerts&loc=Los+Angeles&daterange=thisweekend",
    { waitUntil: "domcontentloaded", timeout: 30000 }
  );
  await page.waitForTimeout(5000);

  for (let i = 0; i < 3; i++) {
    await page.evaluate("window.scrollBy(0, 600)");
    await page.waitForTimeout(600);
  }

  // ── Step 1: DOM structure of first event card ──────────────────────────────
  const cardInfo = await page.evaluate(() => {
    const links = document.querySelectorAll('[data-testid="event-list-link"]');
    if (!links.length) return { error: "no event-list-links found" };

    const el = links[0];
    const li = el.closest("li");

    function getXPath(el) {
      const parts = [];
      let node = el;
      while (node && node.nodeType === 1) {
        let idx = 1;
        let sib = node.previousElementSibling;
        while (sib) { if (sib.tagName === node.tagName) idx++; sib = sib.previousElementSibling; }
        parts.unshift(`${node.tagName.toLowerCase()}[${idx}]`);
        node = node.parentElement;
      }
      return "/" + parts.join("/");
    }

    function isScreenReaderOnly(el) {
      const s = window.getComputedStyle(el);
      return s.position === "absolute" && (
        s.width === "1px" || s.height === "1px" ||
        (s.clip && s.clip !== "auto") || s.clipPath === "inset(50%)"
      );
    }

    // All nodes in this card with key attrs
    const nodes = [];
    const walk = document.createTreeWalker(li || el, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walk.nextNode())) {
      const direct = Array.from(node.childNodes)
        .filter((n) => n.nodeType === 3)
        .map((n) => n.textContent.trim())
        .filter((t) => t.length > 0)
        .join(" | ");
      nodes.push({
        tag: node.tagName,
        id: node.id || undefined,
        ariaLabel: node.getAttribute("aria-label") || undefined,
        role: node.getAttribute("role") || undefined,
        testid: node.getAttribute("data-testid") || undefined,
        directText: direct || undefined,
      });
    }

    const visibleLeafXPaths = [];
    const srOnlyLeafXPaths = [];
    const allSpans = (li || el).querySelectorAll("span");
    for (const span of allSpans) {
      if (span.children.length === 0 && span.textContent.trim().length > 1) {
        const entry = { xpath: getXPath(span), text: span.textContent.trim().substring(0, 100) };
        if (isScreenReaderOnly(span)) srOnlyLeafXPaths.push(entry);
        else visibleLeafXPaths.push(entry);
      }
    }

    return {
      nodes: nodes.slice(0, 40),
      visibleLeafXPaths: visibleLeafXPaths.slice(0, 10),
      srOnlyLeafXPaths: srOnlyLeafXPaths.slice(0, 8),
    };
  });

  if (cardInfo.error) { console.error(cardInfo.error); process.exit(1); }

  console.log("\n════ DOM STRUCTURE (first 40 nodes in first card) ════");
  for (const n of cardInfo.nodes) {
    const attrs = [
      n.id && `id="${n.id}"`,
      n.ariaLabel && `aria-label="${n.ariaLabel}"`,
      n.role && `role="${n.role}"`,
      n.testid && `data-testid="${n.testid}"`,
    ].filter(Boolean).join(" ");
    console.log(`  <${n.tag}${attrs ? " " + attrs : ""}>${n.directText ? ` "${n.directText}"` : ""}`);
  }

  console.log("\n════ VISIBLE LEAF SPANS (DOM order) ════");
  for (const s of cardInfo.visibleLeafXPaths) {
    console.log(`  "${s.text}"  →  ${s.xpath}`);
  }

  console.log("\n════ SR-ONLY LEAF SPANS ════");
  for (const s of cardInfo.srOnlyLeafXPaths) {
    console.log(`  "${s.text}"  →  ${s.xpath}`);
  }

  // ── Step 2: extractAriaScopeForXPath on visible leaves ────────────────────
  console.log("\n════ extractAriaScopeForXPath — VISIBLE LEAVES ════");
  for (const s of cardInfo.visibleLeafXPaths.slice(0, 6)) {
    const scope = await extractAriaScopeForXPath(page, s.xpath);
    console.log(`\n  Text: "${s.text}"`);
    if (scope && scope.ancestor) {
      const a = scope.ancestor;
      console.log(`  ARIA ancestor: <${a.tagName} id="${a.id}" aria-label="${a.ariaLabel}" role="${a.role}"> (${a.stepsFromTarget} up)`);
      console.log(`  textMatchCount=${scope.textMatchCount}  xpathTail=${scope.xpathTail}`);
    } else {
      console.log(`  No ARIA ancestor found. targetText="${scope && scope.targetText}"`);
    }
  }

  // ── Step 3: extractAriaScopeForXPath on SR-only leaves ────────────────────
  console.log("\n════ extractAriaScopeForXPath — SR-ONLY LEAVES ════");
  for (const s of cardInfo.srOnlyLeafXPaths.slice(0, 5)) {
    const scope = await extractAriaScopeForXPath(page, s.xpath);
    console.log(`\n  Text: "${s.text}"`);
    if (scope && scope.ancestor) {
      const a = scope.ancestor;
      console.log(`  ARIA ancestor: <${a.tagName} id="${a.id}" aria-label="${a.ariaLabel}" role="${a.role}"> (${a.stepsFromTarget} up)`);
      console.log(`  textMatchCount=${scope.textMatchCount}  xpathTail=${scope.xpathTail}`);
    } else {
      console.log(`  No ARIA ancestor found`);
    }
  }

  await context.close();
  process.exit(0);
})();
