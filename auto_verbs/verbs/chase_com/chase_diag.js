/**
 * DOM Diagnostic for locator.chase.com
 * Discovers actual selectors for search input and location result cards.
 */
const { Stagehand } = require("@browserbasehq/stagehand");
const { setupLLMClient } = require("../../stagehand-utils");
const fs = require("fs");
const path = require("path");
const os = require("os");

// ── Hard kill switch — prevent hanging VS Code ───────────────────────────────
const GLOBAL_TIMEOUT_MS = 90_000;
const _killTimer = setTimeout(() => {
  console.error("\n⏱️  Global timeout — force-exiting.");
  process.exit(2);
}, GLOBAL_TIMEOUT_MS);
_killTimer.unref();

// Use a temp profile to avoid Chrome profile-lock contention
function getTempProfileDir() {
  const tmp = path.join(os.tmpdir(), `chase_diag_profile_${Date.now()}`);
  fs.mkdirSync(tmp, { recursive: true });
  const src = path.join(
    os.homedir(), "AppData", "Local", "Google", "Chrome", "User Data", "Default"
  );
  for (const file of ["Preferences", "Local State"]) {
    const srcFile = path.join(src, file);
    if (fs.existsSync(srcFile)) {
      try { fs.copyFileSync(srcFile, path.join(tmp, file)); } catch (_) {}
    }
  }
  console.log(`📁 Temp profile: ${tmp}`);
  return tmp;
}

async function main() {
  const llmClient = setupLLMClient("hybrid");
  const tempProfile = getTempProfileDir();
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    llmClient,
    localBrowserLaunchOptions: {
      userDataDir: tempProfile,
      headless: false,
      viewport: { width: 1920, height: 1080 },
      args: [
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--disable-extensions",
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-background-networking",
        "--start-maximized",
        "--window-size=1920,1080",
      ],
    },
  });
  await stagehand.init();
  const page = stagehand.context.pages()[0];

  console.log("=== Navigating to locator.chase.com ===");
  await page.goto("https://locator.chase.com", { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(5000);
  console.log("Current URL:", page.url());

  // 1. Dump all input elements
  console.log("\n=== ALL INPUT ELEMENTS ===");
  const inputs = await page.evaluate(() => {
    return [...document.querySelectorAll("input")].map(el => ({
      tag: el.tagName,
      type: el.type,
      id: el.id,
      name: el.name,
      className: el.className,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute("aria-label"),
      visible: el.offsetParent !== null,
      rect: el.getBoundingClientRect(),
    }));
  });
  inputs.forEach((inp, i) => console.log(`  [${i}]`, JSON.stringify(inp)));

  // 2. Dump all buttons
  console.log("\n=== ALL BUTTONS ===");
  const buttons = await page.evaluate(() => {
    return [...document.querySelectorAll("button, [role='button'], a.btn, input[type='submit']")].slice(0, 20).map(el => ({
      tag: el.tagName,
      type: el.type,
      id: el.id,
      className: el.className,
      text: el.innerText?.slice(0, 80),
      ariaLabel: el.getAttribute("aria-label"),
      visible: el.offsetParent !== null,
    }));
  });
  buttons.forEach((btn, i) => console.log(`  [${i}]`, JSON.stringify(btn)));

  // 3. Check for iframes (Chase may use iframes)
  console.log("\n=== IFRAMES ===");
  const iframes = await page.evaluate(() => {
    return [...document.querySelectorAll("iframe")].map(el => ({
      id: el.id,
      name: el.name,
      src: el.src,
      className: el.className,
    }));
  });
  iframes.forEach((f, i) => console.log(`  [${i}]`, JSON.stringify(f)));

  // 4. Check for shadow DOM roots
  console.log("\n=== SHADOW DOM HOSTS ===");
  const shadowHosts = await page.evaluate(() => {
    const hosts = [];
    function walk(node) {
      if (node.shadowRoot) {
        hosts.push({
          tag: node.tagName,
          id: node.id,
          className: node.className,
        });
      }
      for (const child of node.children || []) walk(child);
    }
    walk(document.body);
    return hosts;
  });
  shadowHosts.forEach((h, i) => console.log(`  [${i}]`, JSON.stringify(h)));

  // 5. Page title and key structural elements
  console.log("\n=== PAGE STRUCTURE ===");
  const structure = await page.evaluate(() => {
    const title = document.title;
    const h1s = [...document.querySelectorAll("h1")].map(el => el.innerText?.slice(0, 100));
    const h2s = [...document.querySelectorAll("h2")].map(el => el.innerText?.slice(0, 100));
    const bodyClasses = document.body.className;
    const mainSections = [...document.querySelectorAll("main, [role='main'], #app, #root, .app, .main")].map(el => ({
      tag: el.tagName,
      id: el.id,
      className: el.className?.slice(0, 100),
    }));
    return { title, h1s, h2s, bodyClasses, mainSections };
  });
  console.log("  Title:", structure.title);
  console.log("  H1s:", structure.h1s);
  console.log("  H2s:", structure.h2s);
  console.log("  Body classes:", structure.bodyClasses);
  console.log("  Main sections:", structure.mainSections);

  // 6. Dump outer HTML of body's direct children (top-level structure)
  console.log("\n=== BODY DIRECT CHILDREN ===");
  const bodyChildren = await page.evaluate(() => {
    return [...document.body.children].map(el => ({
      tag: el.tagName,
      id: el.id,
      className: el.className?.toString().slice(0, 100),
      childCount: el.children.length,
      text: el.innerText?.slice(0, 120),
    }));
  });
  bodyChildren.forEach((c, i) => console.log(`  [${i}]`, JSON.stringify(c)));

  // 7. Try typing in the search and see what happens
  // First, let's look for any search-related element more broadly
  console.log("\n=== SEARCH-RELATED ELEMENTS (broader) ===");
  const searchRelated = await page.evaluate(() => {
    const all = document.querySelectorAll("*");
    const results = [];
    for (const el of all) {
      const id = el.id || "";
      const cls = el.className?.toString() || "";
      const ph = el.placeholder || "";
      const aria = el.getAttribute("aria-label") || "";
      const role = el.getAttribute("role") || "";
      const text = (id + cls + ph + aria + role).toLowerCase();
      if (text.includes("search") || text.includes("location") || text.includes("address") || text.includes("zip")) {
        if (results.length < 30) {
          results.push({
            tag: el.tagName,
            id: el.id,
            className: cls.slice(0, 100),
            placeholder: ph,
            ariaLabel: aria,
            role: role,
            type: el.type,
            visible: el.offsetParent !== null,
          });
        }
      }
    }
    return results;
  });
  searchRelated.forEach((el, i) => console.log(`  [${i}]`, JSON.stringify(el)));

  console.log("\n=== DONE ===");
  clearTimeout(_killTimer);
  await stagehand.close();
}

main().catch(e => { console.error("DIAG ERROR:", e.message); clearTimeout(_killTimer); process.exit(1); });
