/**
 * Demo 01 — Stagehand Act() Caching
 *
 * Shows how cacheDir enables instant action replay without LLM calls.
 *
 *   RUN 1 (cold): LLM resolves every selector  → ~3–8s per step
 *   RUN 2 (warm): Selectors replayed from disk  → <50ms per step
 *
 * Run:
 *   pnpm example v3/demo_01_caching
 *
 * Optional env:
 *   OPENROUTER_API_KEY  (preferred)
 *   OPENAI_API_KEY      (fallback)
 *   STAGEHAND_MODEL     (default: google/gemini-2.5-pro)
 *   CAMOUFOX_WS         (if set, uses camoufox instead of local Chromium)
 */

import { chromium } from "playwright-core";
import { Stagehand } from "../../lib/v3/index.js";

import fs from "fs";
import path from "path";

// ── Env ──────────────────────────────────────────────────────────────────────

const OPENROUTER_KEY = process.env["OPENROUTER_API_KEY"] ?? "";
const OPENAI_KEY     = process.env["OPENAI_API_KEY"] ?? "";
const MODEL_NAME     = process.env["STAGEHAND_MODEL"] ?? "google/gemini-2.5-pro";
const CAMOUFOX_WS    = process.env["CAMOUFOX_WS"] ?? "";

if (!OPENROUTER_KEY && !OPENAI_KEY) {
  console.error("ERROR: Set OPENROUTER_API_KEY or OPENAI_API_KEY in .env");
  process.exit(1);
}

const model = OPENROUTER_KEY
  ? {
      modelName: `openai/${MODEL_NAME}` as `${string}/${string}`,
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: OPENROUTER_KEY,
    }
  : { modelName: "gpt-4.1-mini" as const, apiKey: OPENAI_KEY };

// ── Style helpers ─────────────────────────────────────────────────────────────

const RST = "\x1b[0m";
const B   = "\x1b[1m";
const DIM = "\x1b[2m";
const G   = "\x1b[32m";
const Y   = "\x1b[33m";
const C   = "\x1b[36m";
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
  console.log(`\n${B}${C}── ${label} ${"─".repeat(Math.max(0, 46 - label.length))}${RST}`);
}

function fmtMs(n: number): string {
  return n < 1000
    ? `${B}${n.toLocaleString()}ms${RST}`
    : `${B}${(n / 1000).toFixed(2)}s${RST}`;
}

function cacheBadge(s?: "HIT" | "MISS"): string {
  if (s === "HIT")  return `${G}${B}✓ HIT ${RST}`;
  if (s === "MISS") return `${Y}${B}• MISS${RST}`;
  return `${DIM}  —  ${RST}`;
}

// ── Cache directory ───────────────────────────────────────────────────────────

const CACHE_DIR = path.resolve(".cache", "stagehand-demo-01");

// ── Automation steps ──────────────────────────────────────────────────────────

const STEPS: { label: string; instruction: string }[] = [
  {
    label:       "Click the 'love' tag",
    instruction: "click the 'love' tag in the tag cloud on the right side",
  },
  {
    label:       "Click Next page",
    instruction: "click the 'Next' button to go to the next page of quotes",
  },
];

// ── One full automation run ───────────────────────────────────────────────────

async function runAutomation(
  runLabel: string,
  browser?: Awaited<ReturnType<typeof chromium.connect>>,
): Promise<{ stepMs: number[]; total: number }> {
  section(runLabel);

  // External camoufox page or managed local Chromium
  let externalCtx: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  let externalPage: Awaited<ReturnType<typeof externalCtx.newPage>> | undefined;
  if (browser) {
    externalCtx  = browser.contexts()[0] ?? await browser.newContext();
    externalPage = externalCtx.pages()[0] ?? await externalCtx.newPage();
  }

  // The local file-based cache (cacheDir) logs "act cache hit" via the logger
  // rather than setting ActResult.cacheStatus (that field is Browserbase-only).
  // Intercept the logger to capture HIT/MISS per step.
  let stepCacheStatus: "HIT" | "MISS" = "MISS";

  const sh = new Stagehand({
    env:         "LOCAL",
    model,
    cacheDir:    CACHE_DIR,
    verbose:     2,
    disablePino: true,
    logger: (line) => {
      if (line.category === "cache" && typeof line.message === "string") {
        if (line.message.includes("act cache hit")) stepCacheStatus = "HIT";
        if (line.message.includes("act cache miss")) stepCacheStatus = "MISS";
      }
    },
    ...(externalCtx ? { browserContext: externalCtx } : {}),
  });

  await sh.init();

  // Navigate using the underlying Playwright page
  const page = externalPage ?? sh.context.pages()[0];
  await page.goto("https://quotes.toscrape.com");
  await page.waitForLoadState("networkidle");

  const stepMs: number[] = [];
  const runStart = Date.now();

  for (const step of STEPS) {
    stepCacheStatus = "MISS"; // reset before each act()
    const t0 = process.hrtime.bigint();
    try {
      if (externalPage) {
        await sh.act(step.instruction, { page: externalPage });
      } else {
        await sh.act(step.instruction);
      }
    } catch {
      console.log(`  ${Y}⚠ step "${step.label}" failed — skipping${RST}`);
      stepMs.push(0);
      continue;
    }
    const elapsed = Math.round(Number(process.hrtime.bigint() - t0) / 1_000_000);
    stepMs.push(elapsed);

    const note = stepCacheStatus === "HIT"
      ? `${DIM}selector replayed from disk (no LLM call)${RST}`
      : `${DIM}LLM resolved selector → written to cache${RST}`;

    console.log(
      `  ${cacheBadge(stepCacheStatus)}  ${fmtMs(elapsed).padEnd(20)}  ${step.label}\n             ${note}`,
    );

    // Let the page settle after navigation
    await new Promise((r) => setTimeout(r, 500));
  }

  const total = Date.now() - runStart;
  console.log(`\n  ${B}Total wall time: ${fmtMs(total)}${RST}`);

  await sh.close();
  return { stepMs, total };
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  banner("STAGEHAND CACHING DEMO");

  const usingCamoufox = Boolean(CAMOUFOX_WS);
  console.log(`${DIM}Browser: ${usingCamoufox ? "camoufox (Firefox)" : "local Chromium"}${RST}`);
  console.log(`${DIM}Site:    quotes.toscrape.com${RST}`);
  console.log(`${DIM}Steps:   ${STEPS.length} act() calls${RST}`);
  console.log(`${DIM}Cache:   ${CACHE_DIR}${RST}`);

  // Clear cache before run 1 to guarantee a cold start
  if (fs.existsSync(CACHE_DIR)) {
    fs.rmSync(CACHE_DIR, { recursive: true, force: true });
    console.log(`${DIM}(Cleared existing cache for clean demo.)${RST}`);
  }

  // Connect camoufox once (keep alive across both runs)
  let camoufoxBrowser: Awaited<ReturnType<typeof chromium.connect>> | undefined;
  if (CAMOUFOX_WS) {
    console.log(`\n${DIM}Connecting to camoufox …${RST}`);
    camoufoxBrowser = await chromium.connect({ wsEndpoint: CAMOUFOX_WS });
    console.log(`${DIM}Connected: ${camoufoxBrowser.version()}${RST}`);
  }

  const r1 = await runAutomation("RUN 1 — Cold Start (empty cache)", camoufoxBrowser);
  const r2 = await runAutomation("RUN 2 — Warm Cache (instant replay)", camoufoxBrowser);

  if (camoufoxBrowser) await camoufoxBrowser.close().catch(() => {});

  // ── Summary ──────────────────────────────────────────────────────────────
  section("Summary");
  const speedup = r2.total > 0 ? Math.round(r1.total / r2.total) : "∞";
  console.log(`  Run 1 (cold):  ${fmtMs(r1.total)}  — LLM called for every selector`);
  console.log(`  Run 2 (warm):  ${fmtMs(r2.total)}  — All selectors served from disk`);
  console.log(
    `\n  ${G}${B}${speedup}× faster on second run${RST}`,
  );
  console.log(
    `\n  ${DIM}The cache survives process restarts.${RST}`,
  );
  console.log(
    `  ${DIM}Kill this script and run it again — Run 2 timing holds.${RST}\n`,
  );
})();
