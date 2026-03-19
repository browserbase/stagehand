/**
 * Demo 03 — Shadow DOM Piercing: Before & After Phase 8
 *
 * No LLM or camoufox required — uses headless Chromium only.
 *
 * Demonstrates the closed shadow DOM support added in Phase 8:
 *   pierceShadow: true             → sees open shadows, MISSES closed shadows
 *   pierceShadow: "including-closed" → sees BOTH open and closed shadows
 *
 * Run:
 *   pnpm example v3/demo_03_shadow_dom
 */

import { chromium } from "playwright-core";
import { captureNativeSnapshot } from "../../lib/v3/understudy/native/snapshot/captureNativeSnapshot.js";
import type { NativeA11yOptions } from "../../lib/v3/types/private/snapshot.js";

// ── Style helpers ─────────────────────────────────────────────────────────────

const RST = "\x1b[0m";
const B   = "\x1b[1m";
const DIM = "\x1b[2m";
const G   = "\x1b[32m";
const Y   = "\x1b[33m";
const C   = "\x1b[36m";
const RED = "\x1b[31m";
const BLU = "\x1b[34m";

function banner(title: string) {
  const w = 52;
  const line = "═".repeat(w);
  const pad  = Math.floor((w - title.length) / 2);
  const padded = " ".repeat(pad) + title + " ".repeat(w - pad - title.length);
  console.log(`\n${B}${BLU}╔${line}╗${RST}`);
  console.log(`${B}${BLU}║${padded}║${RST}`);
  console.log(`${B}${BLU}╚${line}╝${RST}\n`);
}

function section(label: string) {
  console.log(`\n${B}${Y}── ${label} ${"─".repeat(Math.max(0, 46 - label.length))}${RST}`);
}

// ── Test page HTML ────────────────────────────────────────────────────────────
//
// Contains three kinds of content:
//   1. Regular DOM          — always visible
//   2. Open shadow root     — visible with pierceShadow: true
//   3. Closed shadow root   — only visible with pierceShadow: "including-closed"
//
const PAGE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><title>Shadow DOM Demo</title></head>
<body>
  <h1>Shadow DOM Demo Page</h1>
  <p>I am regular page content.</p>

  <!-- Open shadow root (declarative via template) -->
  <section id="open-host">
    <template shadowrootmode="open">
      <nav aria-label="Open Shadow Navigation">
        <button>Open Shadow Button</button>
        <a href="#open">Open Shadow Link</a>
        <p role="note">I live inside an OPEN shadow root</p>
      </nav>
    </template>
  </section>

  <!-- Closed shadow root — created imperatively after page load -->
  <section id="closed-host"></section>

  <script>
    var host = document.getElementById("closed-host");
    var root = host.attachShadow({ mode: "closed" });
    root.innerHTML =
      '<nav aria-label="Closed Shadow Navigation">' +
        '<button>Closed Shadow Button</button>' +
        '<a href="#closed">Closed Shadow Link</a>' +
        '<p role="note">I live inside a CLOSED shadow root</p>' +
      "</nav>";
  </script>

  <footer>Regular footer content</footer>
</body>
</html>`;

// ── Closed-shadow interceptor init script ─────────────────────────────────────
// Must be installed via addInitScript BEFORE setContent so the WeakMap
// interceptor is in place when the page's <script> calls attachShadow.

const CLOSED_SHADOW_INTERCEPTOR = `(function() {
  if (typeof window.__stagehandClosedRoot === "function" || window.__stagehandClosedRootInstalled) return;
  try {
    var _closed = new WeakMap();
    var _orig = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function(init) {
      var root = _orig.call(this, init);
      if (init && init.mode === "closed") _closed.set(this, root);
      return root;
    };
    window.__stagehandClosedRoot = function(host) { return _closed.get(host) ?? null; };
    window.__stagehandClosedRootInstalled = true;
  } catch (e) {}
})();`;

// ── Capture helper ────────────────────────────────────────────────────────────

async function capture(
  page: import("playwright-core").Page,
  opts: NativeA11yOptions,
): Promise<{ tree: string; lines: string[] }> {
  const snap = await captureNativeSnapshot(page, opts);
  const lines = snap.combinedTree.trim().split("\n");
  return { tree: snap.combinedTree, lines };
}

function printTree(lines: string[]) {
  for (const line of lines) {
    if (line.includes("OPEN shadow root") || line.includes("Open Shadow")) {
      console.log(`    ${G}${line}${RST}`);
    } else if (line.includes("CLOSED shadow root") || line.includes("Closed Shadow")) {
      console.log(`    ${C}${line}${RST}`);
    } else {
      console.log(`    ${DIM}${line}${RST}`);
    }
  }
}

function yesNo(bool: boolean, trueLabel = "YES", falseLabel = "NO"): string {
  return bool
    ? `${G}${B}${trueLabel}${RST}`
    : `${RED}${B}${falseLabel}${RST}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  banner("SHADOW DOM PIERCING — PHASE 8 DEMO");

  console.log(`${DIM}Enterprise UI components (SAP, Salesforce, ServiceNow) frequently use${RST}`);
  console.log(`${DIM}closed shadow roots to encapsulate their DOM. Without Phase 8, Stagehand${RST}`);
  console.log(`${DIM}could not see — or interact with — anything inside them.${RST}`);

  const browser = await chromium.launch({ headless: true });
  const ctx     = await browser.newContext();
  const page    = await ctx.newPage();

  // Install the interceptor BEFORE setContent — this is the critical ordering.
  // addInitScript runs before any inline <script> tags in the loaded HTML.
  await page.addInitScript(CLOSED_SHADOW_INTERCEPTOR);
  await page.setContent(PAGE_HTML);

  console.log(`\n${B}The page contains:${RST}`);
  console.log(`  ${G}●${RST}  An OPEN shadow root   — visible with pierceShadow: true`);
  console.log(`  ${C}●${RST}  A CLOSED shadow root  — ${B}only${RST} visible with pierceShadow: "including-closed"`);
  console.log(`  ${DIM}●  Regular page content — always visible${RST}`);

  // ── Mode A: pierceShadow: true (default behaviour, unchanged) ─────────────
  section(`Mode A — pierceShadow: true  (default, open shadows only)`);
  const a = await capture(page, {
    pierceShadow: true,
    includeIframes: false,
    experimental: false,
  });
  printTree(a.lines);

  const aHasOpen   = a.tree.includes("Open Shadow");
  const aHasClosed = a.tree.includes("Closed Shadow");

  console.log(`\n  Open shadow content visible   : ${yesNo(aHasOpen,   "YES (expected)", "NO — bug!")}`);
  console.log(`  Closed shadow content visible : ${yesNo(aHasClosed, "YES", "NO (expected — cannot pierce closed)")}`);
  console.log(`  Snapshot line count: ${a.lines.length}`);

  // ── Mode B: pierceShadow: "including-closed" (Phase 8) ────────────────────
  section(`Mode B — pierceShadow: "including-closed"  (Phase 8 — NEW)`);
  const b = await capture(page, {
    pierceShadow: "including-closed",
    includeIframes: false,
    experimental: false,
  });
  printTree(b.lines);

  const bHasOpen   = b.tree.includes("Open Shadow");
  const bHasClosed = b.tree.includes("Closed Shadow");

  console.log(`\n  Open shadow content visible   : ${yesNo(bHasOpen,   "YES (still works)", "NO — regression!")}`);
  console.log(`  Closed shadow content visible : ${yesNo(bHasClosed, "YES  ← Phase 8 ✓", "NO — bug!")}`);
  console.log(`  Snapshot line count: ${b.lines.length}`);

  // ── diff summary ──────────────────────────────────────────────────────────
  section("What Phase 8 unlocks");
  const newLines = b.lines.length - a.lines.length;
  console.log(`  pierceShadow: true              → ${a.lines.length} lines in snapshot`);
  console.log(`  pierceShadow: "including-closed" → ${b.lines.length} lines in snapshot`);
  console.log(`  Newly visible nodes             → ${G}${B}+${newLines}${RST} from closed shadow DOM`);

  console.log(`
  ${G}${B}Elements now reachable by Stagehand:${RST}
    ${C}• Closed Shadow Button${RST}   — can be act()'d via selector
    ${C}• Closed Shadow Link${RST}     — can be act()'d via selector
    ${C}• note: "I live inside a CLOSED shadow root"${RST}  — can be extract()'d

  ${DIM}opt-in: new Stagehand({ ... })
  then: stagehand.captureSnapshot({ pierceShadow: "including-closed" })${RST}
`);

  await browser.close();
})();
