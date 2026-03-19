/**
 * Demo 02 — Camoufox + Observe + Structured Extract
 *
 * Runs Stagehand on Firefox (camoufox stealth browser) via the native
 * Playwright path introduced in this sprint. No CDP. Pure Playwright APIs.
 *
 * Shows:
 *   • Connecting Stagehand to an externally-managed BrowserContext
 *   • observe() — natural-language scan of what's actionable on a page
 *   • extract() — pulling structured JSON from a live page
 *   • The ARIA snapshot that drives both (Phase 6/7 improvements)
 *
 * Run:
 *   pnpm example v3/demo_02_camoufox_extract
 *
 * Required env:
 *   CAMOUFOX_WS         — WebSocket URL printed by camoufox on startup
 *
 * Optional env:
 *   OPENROUTER_API_KEY  (preferred)
 *   OPENAI_API_KEY      (fallback)
 *   STAGEHAND_MODEL     (default: google/gemini-2.5-pro)
 */

import { chromium } from "playwright-core";
import { Stagehand } from "../../lib/v3/index.js";
import { z } from "zod";

// ── Env ──────────────────────────────────────────────────────────────────────

const WS = process.env["CAMOUFOX_WS"] ?? "";
if (!WS) {
  console.error(
    "ERROR: CAMOUFOX_WS not set.\n" +
    "Start camoufox, copy the ws:// URL, and set it in .env:\n" +
    "  CAMOUFOX_WS=ws://localhost:<port>/<token>",
  );
  process.exit(1);
}

const OPENROUTER_KEY = process.env["OPENROUTER_API_KEY"] ?? "";
const OPENAI_KEY     = process.env["OPENAI_API_KEY"] ?? "";
const MODEL_NAME     = process.env["STAGEHAND_MODEL"] ?? "google/gemini-2.5-pro";

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

function step(n: number, label: string) {
  console.log(`\n${B}${C}${n}. ${label}${RST}`);
}

function ms(n: number): string {
  return n < 1000
    ? `${DIM}${n.toLocaleString()}ms${RST}`
    : `${DIM}${(n / 1000).toFixed(2)}s${RST}`;
}

// ── Schemas ───────────────────────────────────────────────────────────────────

// Keep schemas small to stay within model token limits
const QuoteSchema = z.object({
  quotes: z.array(
    z.object({
      author: z.string(),
      text:   z.string().describe("First 60 characters of the quote text only"),
    }),
  ).describe("Up to 5 quotes from the page"),
});

const BooksSchema = z.object({
  books: z.array(
    z.object({
      title:  z.string(),
      price:  z.string().describe("Price as shown, e.g. '£51.77'"),
      rating: z.string().describe("Star rating word, e.g. 'Three'"),
    }),
  ).describe("Up to 8 books from the catalogue"),
});

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  banner("CAMOUFOX + STAGEHAND NATIVE MODE");

  // ── 1. Connect to camoufox (Firefox stealth browser) ─────────────────────
  step(1, "Connect to camoufox");
  const browser = await chromium.connect({ wsEndpoint: WS });
  const ctx  = browser.contexts()[0] ?? await browser.newContext();
  const page = ctx.pages()[0] ?? await ctx.newPage();

  console.log(`   Browser version : ${G}${browser.version()}${RST}`);
  const ua = await page.evaluate(() => navigator.userAgent);
  console.log(`   User-Agent      : ${DIM}${ua.slice(0, 80)}${RST}`);

  // ── 2. Init Stagehand wired to camoufox context ───────────────────────────
  step(2, "Init Stagehand with camoufox browserContext");
  const sh = new Stagehand({
    env:         "LOCAL",
    browserContext: ctx,
    model,
    verbose:     0,
    disablePino: true,
  });
  await sh.init();
  console.log(`   ${G}✓ Stagehand ready (no CDP — pure Playwright API)${RST}`);

  // ── 3. Navigate to quotes.toscrape.com ────────────────────────────────────
  step(3, "Navigate to quotes.toscrape.com");
  await page.goto("https://quotes.toscrape.com");
  await page.waitForLoadState("networkidle");
  console.log(`   Title: ${await page.title()}`);

  // ── 4. observe() — scan available actions ────────────────────────────────
  step(4, "observe() — what can we do on this page?");
  const t0 = Date.now();
  const actions = await sh.observe(
    "list all interactive elements and navigation links",
    { page, timeout: 30_000 },
  );
  console.log(`   ${ms(Date.now() - t0)}  Found ${G}${B}${actions.length}${RST} actionable elements:\n`);
  for (const a of actions.slice(0, 8)) {
    console.log(`   ${Y}▸${RST} ${a.description}`);
  }
  if (actions.length > 8) {
    console.log(`   ${DIM}  … and ${actions.length - 8} more${RST}`);
  }

  // ── 5. extract() — get quotes as structured JSON ─────────────────────────
  step(5, "extract() — quotes as structured JSON");
  const t1 = Date.now();
  let quoteResult: { quotes: { author: string; text: string }[] } | null = null;
  try {
    quoteResult = await sh.extract(
      "extract up to 5 quotes from this page — for each quote get the author name and the first 60 characters of the quote text",
      QuoteSchema,
      { page, timeout: 30_000 },
    );
  } catch (err) {
    console.log(`   ${Y}⚠ extract threw (${String(err).slice(0, 80)})${RST}`);
  }
  const quotes = quoteResult?.quotes ?? [];
  console.log(`   ${ms(Date.now() - t1)}  Extracted ${G}${B}${quotes.length}${RST} quotes:\n`);
  for (const q of quotes) {
    console.log(`   ${C}"${q.text}…"${RST}`);
    console.log(`     ${DIM}— ${q.author}${RST}\n`);
  }

  // ── 6. Navigate to books.toscrape.com and do a richer extraction ─────────
  step(6, "Navigate to books.toscrape.com — richer extraction");
  await page.goto("https://books.toscrape.com");
  await page.waitForLoadState("networkidle");
  console.log(`   Title: ${await page.title()}`);

  const t2 = Date.now();
  let bookResult: { books: { title: string; price: string; rating: string }[] } | null = null;
  try {
    bookResult = await sh.extract(
      "extract up to 8 books from the catalogue — for each: title, price (e.g. £12.34), and star rating word (One/Two/Three/Four/Five)",
      BooksSchema,
      { page, timeout: 30_000 },
    );
  } catch (err) {
    console.log(`   ${Y}⚠ extract threw (${String(err).slice(0, 80)})${RST}`);
  }
  const books = bookResult?.books ?? [];
  console.log(`   ${ms(Date.now() - t2)}  Extracted ${G}${B}${books.length}${RST} books:\n`);
  for (const bk of books) {
    console.log(
      `   ${B}${bk.title.slice(0, 40).padEnd(42)}${RST}  ${Y}${bk.price}${RST}  ${DIM}★ ${bk.rating}${RST}`,
    );
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  await sh.close();
  await browser.close().catch(() => {});
  console.log(`\n${G}${B}✓ Done.${RST}\n`);
})();
