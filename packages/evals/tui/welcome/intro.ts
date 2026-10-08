/**
 * The welcome intro — one 12-row slot, ~10s, one continuous upward push.
 *
 *   1. flash    The Stagehand mark flashes in white and cools to its colors.
 *   2. explain  Everything pushes up: the mark leaves through the top while
 *               one sentence and three meters rise into place — what evals
 *               does, and what it measures (accuracy · speed · cost), in a
 *               single frame.
 *   3. EVALS    Pushed up again: the explanation leaves, EVALS rises in as a
 *               silhouette, materializes left→right, a light passes, and it
 *               stays as scrollback.
 *
 * The whole thing is a single pure timeline, `introFrame(ms)`, drawn on a
 * vertical track that scrolls — so beats hand over by motion, never by a cut.
 * The mark is set on the pixel grid (mark.ts); half-blocks give two pixels
 * per cell.
 *
 * Metric colors are law: accuracy → brand green, speed → cyan, cost → amber.
 *
 * Input: any key jumps to the next beat, Esc to EVALS, Ctrl+C cancels.
 * Off-TTY / narrow terminals print the settled EVALS once.
 */

import { BANNER_LINES, BANNER_W } from "../banner.js";
import { Canvas, clamp01, ease, METRIC, mixRgb, PALETTE } from "../fx.js";
import {
  canAnimateInPlace,
  listenKeys,
  LiveBlock,
  READING_MS_PER_WORD,
  setCursorHidden,
  sleep,
  type RGB,
} from "../wizardAnim.js";
import { MARK, MARK_PX } from "./mark.js";

export const INTRO_ROWS = 12;
const FPS = 24;

// ─── Content ────────────────────────────────────────────────────────────

const SENTENCE = "Give an agent a real task in a real browser.";
const METERS: ReadonlyArray<{ label: string; caption: string; color: RGB; fill: number }> = [
  { label: "accuracy", caption: "did it finish the task?", color: METRIC.accuracy, fill: 0.86 },
  { label: "speed", caption: "how long did it take?", color: METRIC.speed, fill: 0.62 },
  { label: "cost", caption: "what did it cost?", color: METRIC.cost, fill: 0.38 },
];
const BAR_W = 24;

// ─── Track (rows, at rest) and timeline (ms) ────────────────────────────

const MARK_TOP = (INTRO_ROWS - MARK_PX / 2) / 2; // centered while it flashes
const EXPLAIN_TOP = 3; // sentence row; meters two rows below
const EVALS_TOP = Math.floor((INTRO_ROWS - BANNER_LINES.length) / 2);
/** One push moves the whole track up by a full slot. */
const PUSH_ROWS = INTRO_ROWS;
const PUSH_MS = 560;

const words = (s: string): number => s.split(/\s+/).filter(Boolean).length;
const READ_MS =
  (words(SENTENCE) + METERS.reduce((n, m) => n + words(m.caption) + 1, 0)) * READING_MS_PER_WORD;

const FLASH_MS = 380;
const PUSH1_AT = 1100; // beat 2 starts as the first push
const LANDED1 = PUSH1_AT + PUSH_MS;
const METERS_AT = LANDED1 + 250;
const PUSH2_AT = LANDED1 + Math.max(4200, READ_MS - 800); // beat 3
const LANDED2 = PUSH2_AT + PUSH_MS;
const REVEAL_MS = 900;
const GLINT_AT = LANDED2 + REVEAL_MS - 150;
const GLINT_MS = 650;
export const INTRO_END_MS = GLINT_AT + GLINT_MS + 450;

const BEATS = [0, PUSH1_AT, PUSH2_AT, INTRO_END_MS];

// ─── Drawing ────────────────────────────────────────────────────────────

const progress = (ms: number, at: number, dur: number): number => clamp01((ms - at) / dur);

/** How far the track has scrolled up, in rows (fractional mid-push). */
function scroll(ms: number): number {
  const push = (at: number): number => ease.inOutSine(progress(ms, at, PUSH_MS)) * PUSH_ROWS;
  return push(PUSH1_AT) + push(PUSH2_AT);
}

/** The mark at pixel row `py` (may be off-slot), flashing white at first. */
function paintMark(cv: Canvas, width: number, py: number, ms: number): void {
  const flash = 1 - ease.outCubic(progress(ms, 0, FLASH_MS));
  const x0 = Math.floor((width - MARK[0].length) / 2);
  const px = (y: number, x: number): RGB | null => {
    const row = y - py;
    if (row < 0 || row >= MARK_PX) return null;
    const base = MARK[row][x] === "G" ? PALETTE.brand : PALETTE.white;
    return mixRgb(base, PALETTE.white, flash);
  };
  // Two pixels per cell: top half = fg of ▀, bottom half = its bg.
  for (let cellY = 0; cellY < INTRO_ROWS; cellY++) {
    for (let x = 0; x < MARK[0].length; x++) {
      const top = px(cellY * 2, x);
      const bottom = px(cellY * 2 + 1, x);
      if (top && bottom) cv.put(x0 + x, cellY, "▀", top, bottom);
      else if (top) cv.put(x0 + x, cellY, "▀", top);
      else if (bottom) cv.put(x0 + x, cellY, "▄", bottom);
    }
  }
}

/** Sentence + three meters, sentence at row `y`. Meters fill once the block lands. */
function paintExplain(cv: Canvas, width: number, y: number, ms: number): void {
  cv.text(Math.floor((width - SENTENCE.length) / 2), y, SENTENCE, PALETTE.white);
  const labelW = Math.max(...METERS.map((m) => m.label.length));
  const captionW = Math.max(...METERS.map((m) => m.caption.length));
  const x0 = Math.floor((width - (labelW + 2 + BAR_W + 2 + captionW)) / 2);
  METERS.forEach((m, i) => {
    const row = y + 2 + i;
    const at = METERS_AT + i * 260;
    const bx = x0 + labelW + 2;
    cv.text(x0 + labelW - m.label.length, row, m.label, m.color);
    for (let j = 0; j < BAR_W; j++) cv.put(bx + j, row, "─", PALETTE.deep);
    // The fill races to its level with a bright head; the caption follows.
    const fill = Math.round(ease.outCubic(progress(ms, at, 900)) * m.fill * BAR_W);
    for (let j = 0; j < fill; j++) cv.put(bx + j, row, "━", m.color);
    if (fill > 0) cv.put(bx + fill - 1, row, "━", mixRgb(m.color, PALETTE.white, 0.55));
    const cap = ease.outCubic(progress(ms, at + 350, 400));
    if (cap > 0) cv.text(bx + BAR_W + 2, row, m.caption, mixRgb(PALETTE.void, PALETTE.slate, cap));
  });
}

/**
 * EVALS at row `y`: a dim block silhouette while it rises, then it
 * materializes column by column (white-hot blocks at the front, the real
 * glyphs cooling to brand behind), and a light passes over it.
 */
function paintEvals(cv: Canvas, width: number, y: number, ms: number): void {
  const t = progress(ms, LANDED2 - 120, REVEAL_MS);
  const glintT = progress(ms, GLINT_AT, GLINT_MS);
  const glintX = glintT > 0 && glintT < 1 ? -6 + (BANNER_W + 12) * ease.inOutSine(glintT) : null;
  const x0 = Math.floor((width - BANNER_W) / 2);
  BANNER_LINES.forEach((line, row) => {
    Array.from(line).forEach((ch, col) => {
      if (ch === " ") return;
      const k = clamp01((t - (col / BANNER_W) * 0.6 - row * 0.015) / 0.3);
      // The silhouette is the solid strokes only, so it already reads as EVALS.
      if (k === 0 && ch !== "█") return;
      let glyph = "█";
      let color = mixRgb(PALETTE.void, PALETTE.deep, 0.9); // silhouette
      if (k > 0 && k < 0.35) color = mixRgb(PALETTE.deep, PALETTE.white, k / 0.35);
      else if (k >= 0.35) {
        glyph = ch;
        color = mixRgb(PALETTE.mint, PALETTE.brand, ease.inOutSine((k - 0.35) / 0.65));
      }
      if (glintX !== null) {
        const d = Math.abs(col - row * 0.6 - glintX) / 4;
        if (d < 1) color = mixRgb(color, PALETTE.white, (1 - d) * 0.6);
      }
      cv.put(x0 + col, y + row, glyph, color);
    });
  });
}

/** The whole intro at `ms` — pure, so tests can render any moment. */
export function introFrame(ms: number, width: number): Canvas {
  const cv = new Canvas(width, INTRO_ROWS);
  const s = scroll(ms);
  // Track positions at rest, minus the scroll. Off-slot rows are clipped.
  const markTop = MARK_TOP - s;
  const explainTop = EXPLAIN_TOP + PUSH_ROWS - s;
  const evalsTop = EVALS_TOP + 2 * PUSH_ROWS - s;
  if (markTop + MARK_PX / 2 > 0) paintMark(cv, width, Math.round(markTop * 2), ms);
  if (explainTop < INTRO_ROWS && explainTop + 5 > 0) {
    paintExplain(cv, width, Math.round(explainTop), ms);
  }
  if (evalsTop < INTRO_ROWS) paintEvals(cv, width, Math.round(evalsTop), ms);
  return cv;
}

// ─── Player ─────────────────────────────────────────────────────────────

/** How the intro ended. `skipped` = Esc (the caller should start its content right away). */
export type IntroOutcome = { aborted: boolean; skipped: boolean };

/**
 * Play the intro in place. Leaves the cursor hidden — callers restore it
 * in their own finally.
 */
export async function runIntro(): Promise<IntroOutcome> {
  setCursorHidden(true);
  const width = Math.max(72, Math.min((process.stdout.columns ?? 80) - 4, 96));
  const region = new LiveBlock();
  let aborted = false;
  let skipped = false;
  let jump = false;
  const input = listenKeys((k) => {
    if (k.name === "ctrl-c") aborted = true;
    else if (k.name === "escape") skipped = true;
    else jump = true;
  });
  try {
    if (canAnimateInPlace()) {
      const start = Date.now();
      let offset = 0;
      for (;;) {
        let ms = Date.now() - start + offset;
        if (jump) {
          // Next beat: land at its start so its push still plays.
          const next = BEATS.find((b) => b > ms) ?? INTRO_END_MS;
          offset += next - ms;
          ms = next;
          jump = false;
        }
        if (aborted || skipped || ms >= INTRO_END_MS) break;
        region.paint(introFrame(ms, width).render());
        await sleep(1000 / FPS);
      }
    }
    if (aborted) return { aborted: true, skipped: false };
    region.paint(introFrame(INTRO_END_MS, width).render(), { final: true });
    process.stdout.write("\n");
    return { aborted: false, skipped };
  } finally {
    input.release();
  }
}
