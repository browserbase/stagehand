/**
 * Design b — Trace.
 *
 * A run leaves a trajectory; evals records it and can re-score it without
 * re-running the agent (`evals verify`). This onboarding is a *player* for
 * one such trajectory — a real WebVoyager task, replayed step by step — that
 * the user scrubs with ← → and space. Interactive and honest: the thing you
 * read here is the unit of evaluation.
 *
 * Motion: a continuous 24fps canvas. The playhead eases between steps and
 * leaves a decaying mint glow on the track; step text slides out left / in
 * from the right; a faint scanline drifts down the card while playing; the
 * clock counts continuously; transcript rows fade in; the judge card flashes,
 * then the verdict pulses. Kind colors: goto slate · think teal · observe
 * cyan · act brand · extract mint · answer white · pass brand / fail rose.
 */

import { c, stripAnsi, visibleLength } from "../format.js";
import { markFirstRunComplete } from "../welcomeState.js";
import { Canvas, animate, clamp01, ease, fg, mixRgb, PALETTE } from "../fx.js";
import {
  canAnimateInPlace,
  listenForSkip,
  listenKeys,
  LiveBlock,
  padTo,
  panel,
  READING_MS_PER_WORD,
  revealLines,
  ruleHeader,
  setCursorHidden,
  sleep,
  termSize,
  type RGB,
  type SkipSignal,
} from "../wizardAnim.js";
import { caseTotalMs, loadScriptedCases, type ScriptedCase, type StepKind } from "./agentScript.js";
import { runIntro } from "./intro.js";
import { detectMachine } from "./detect.js";
import { handoffChip } from "./handoff.js";
import type { WelcomeRunContext, WizardOutcome } from "./types.js";

const FPS = 24;
const TRANSCRIPT_ROWS = 5;
const PLAY_SPEED = 0.45; // replay at ~2× the illustrative timings
const END_DWELL_MS = 1600;
const PLAYHEAD_MS = 260; // playhead glide between steps
const SLIDE_MS = 220; // step text slide
const FADE_MS = 320; // transcript row fade-in
const FLASH_MS = 150; // judge flip flash
const PULSE_MS = 1200; // verdict pulse
const GLOW_DECAY = 0.82;

/** Canvas width: never wider than the terminal, capped for the measure. */
function canvasWidth(): number {
  return Math.max(60, Math.min(termSize().cols - 2, 78));
}

// ─── Kind colors ────────────────────────────────────────────────────────

const KIND_COLOR: Record<StepKind, RGB> = {
  goto: PALETTE.slate,
  think: PALETTE.teal,
  observe: PALETTE.cyan,
  act: PALETTE.brand,
  extract: PALETTE.mint,
  answer: PALETTE.white,
  judge: PALETTE.brand,
};

function clock(ms: number): string {
  const total = Math.max(0, Math.round(ms / 100)); // tenths
  const s = Math.floor(total / 10);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}.${total % 10}`;
}

function fit(text: string, width: number): string {
  const chars = Array.from(text);
  return chars.length <= width ? text : chars.slice(0, Math.max(0, width - 1)).join("") + "…";
}

/** Cumulative ms after completing step `i` (i = -1 → 0). */
function elapsedAt(cs: ScriptedCase, i: number): number {
  let sum = 0;
  for (let k = 0; k <= i && k < cs.steps.length; k++) sum += cs.steps[k].ms;
  return sum;
}
function callsUpTo(cs: ScriptedCase, i: number): number {
  let n = 0;
  for (let k = 0; k <= i && k < cs.steps.length; k++) n += cs.steps[k].calls ?? 0;
  return n;
}

// ─── Canvas helpers ─────────────────────────────────────────────────────

function box(
  cv: Canvas,
  x: number,
  y: number,
  w: number,
  h: number,
  color: RGB,
  title?: string,
): void {
  cv.put(x, y, "╭", color);
  cv.put(x + w - 1, y, "╮", color);
  cv.put(x, y + h - 1, "╰", color);
  cv.put(x + w - 1, y + h - 1, "╯", color);
  for (let i = 1; i < w - 1; i++) {
    cv.put(x + i, y, "─", color);
    cv.put(x + i, y + h - 1, "─", color);
  }
  for (let j = 1; j < h - 1; j++) {
    cv.put(x, y + j, "│", color);
    cv.put(x + w - 1, y + j, "│", color);
  }
  if (title) cv.text(x + 2, y, ` ${title} `, PALETTE.brand);
}

/** Write `s` clipped to [x0, x0 + width) starting at logical offset `off`. */
function clippedText(
  cv: Canvas,
  x0: number,
  width: number,
  y: number,
  off: number,
  s: string,
  color: RGB,
): void {
  let i = 0;
  for (const ch of s) {
    const x = x0 + off + i;
    if (x >= x0 && x < x0 + width) cv.put(x, y, ch, color);
    i++;
  }
}

// ─── Player state ───────────────────────────────────────────────────────

type Player = {
  cs: ScriptedCase;
  n: number;
  /** 0..n-1 = a step; n = the judge. */
  idx: number;
  playing: boolean;
  /** Playhead glide. */
  headFrom: number;
  headAt: number; // ms timestamp glide started
  /** Text slide. */
  slideFrom: number | null;
  slideAt: number;
  /** Autoplay timing for the current step. */
  stepStartedAt: number;
  frozenMs: number;
  /** When each transcript row first appeared. */
  seenAt: Map<number, number>;
  /** Track glow per column. */
  glow: Float64Array;
  judgeAt: number | null;
  scanPhase: number;
};

function nowMs(): number {
  return Date.now();
}

function newPlayer(cs: ScriptedCase, startIdx: number, width: number): Player {
  const n = cs.steps.length;
  const idx = Math.min(startIdx, n);
  const t = nowMs();
  const p: Player = {
    cs,
    n,
    idx,
    playing: idx < n,
    headFrom: idx,
    headAt: t - PLAYHEAD_MS,
    slideFrom: null,
    slideAt: t - SLIDE_MS,
    stepStartedAt: t,
    frozenMs: elapsedAt(cs, idx - 1),
    seenAt: new Map(),
    glow: new Float64Array(width),
    judgeAt: idx >= n ? t : null,
    scanPhase: 0,
  };
  for (let i = 0; i <= Math.min(idx, n - 1); i++) p.seenAt.set(i, t - FADE_MS);
  return p;
}

function goTo(p: Player, to: number): void {
  const t = nowMs();
  if (to === p.idx) return;
  p.headFrom = headPos(p, t);
  p.headAt = t;
  p.slideFrom = p.idx;
  p.slideAt = t;
  p.idx = to;
  p.stepStartedAt = t;
  p.frozenMs = elapsedAt(p.cs, to - 1);
  if (to < p.n && !p.seenAt.has(to)) p.seenAt.set(to, t);
  if (to >= p.n) p.judgeAt = p.judgeAt ?? t;
  else p.judgeAt = null;
}

/** Eased playhead position in step units. */
function headPos(p: Player, t: number): number {
  const k = ease.outCubic(clamp01((t - p.headAt) / PLAYHEAD_MS));
  return p.headFrom + (p.idx - p.headFrom) * k;
}

/** Continuous elapsed clock. */
function shownMs(p: Player, t: number): number {
  if (p.idx >= p.n) return caseTotalMs(p.cs);
  const step = p.cs.steps[p.idx];
  if (!p.playing) return p.frozenMs;
  const frac = clamp01((t - p.stepStartedAt) / Math.max(120, step.ms * PLAY_SPEED));
  return elapsedAt(p.cs, p.idx - 1) + frac * step.ms;
}

// ─── Frame ──────────────────────────────────────────────────────────────

const ROWS = 14;

function drawFrame(p: Player, width: number, t: number): string[] {
  const cv = new Canvas(width, ROWS);
  const { cs, n } = p;
  const atEnd = p.idx >= n;

  // Row 0 — timeline track with gliding playhead + glow trail.
  const total = caseTotalMs(cs);
  const trackX0 = 2;
  const timeLabel = `${(shownMs(p, t) / 1000).toFixed(1)}s / ${(total / 1000).toFixed(1)}s`;
  const trackW = width - trackX0 - timeLabel.length - 3;
  const spacing = Math.max(3, Math.floor((trackW - 1) / Math.max(1, n - 1)));
  const xs = Array.from({ length: n }, (_, i) => trackX0 + i * spacing);
  for (let x = xs[0]; x <= xs[n - 1]; x++) cv.put(x, 0, "─", PALETTE.deep);
  for (let i = 0; i < n; i++) {
    const done = i < p.idx;
    cv.put(xs[i], 0, done ? "◆" : "◇", done ? PALETTE.brand : PALETTE.slate);
  }
  // Glow: decay, then add at the head.
  for (let x = 0; x < width; x++) p.glow[x] *= GLOW_DECAY;
  const hp = headPos(p, t);
  const hx = Math.round(xs[0] + Math.min(hp, n - 1) * spacing);
  if (!atEnd || hp < n - 1 + 0.01) {
    p.glow[hx] = 1;
    for (let x = xs[0]; x <= xs[n - 1]; x++) {
      const g = p.glow[x];
      if (g > 0.06 && x !== hx) {
        const under = cv.glyphs[0][x];
        cv.put(
          x,
          0,
          under,
          mixRgb(x < hx || p.idx < n ? PALETTE.brand : PALETTE.slate, PALETTE.mint, g * 0.9),
        );
      }
    }
    if (!atEnd) cv.put(hx, 0, "●", mixRgb(PALETTE.mint, PALETTE.white, 0.3));
  }
  cv.text(width - timeLabel.length - 1, 0, timeLabel, PALETTE.slate);

  // Rows 2–5 — step / judge card.
  const cardY = 2;
  const cardH = 4;
  const cardW = width - 4;
  const innerX = 4;
  const innerW = cardW - 4;
  if (atEnd) {
    drawJudge(cv, p, t, cardY, cardW, innerX, innerW);
  } else {
    box(cv, 2, cardY, cardW, cardH, PALETTE.deep, `step ${p.idx + 1} of ${n}`);
    // Scanline: one faintly brighter row drifting down the card while playing.
    if (p.playing) p.scanPhase = (p.scanPhase + 0.035) % 1;
    const scanRow = cardY + 1 + Math.floor(p.scanPhase * 2);
    const slideK = ease.outCubic(clamp01((t - p.slideAt) / SLIDE_MS));
    const drawStep = (i: number, off: number, alpha: number): void => {
      if (alpha < 0.06) return; // fully faded — don't leave clipped ghosts
      const s = cs.steps[i];
      const kind = KIND_COLOR[s.kind];
      const lift = (col: RGB, y: number): RGB =>
        y === scanRow
          ? mixRgb(col, PALETTE.white, 0.12 + 0.88 * (1 - alpha))
          : mixRgb(col, PALETTE.void, 1 - alpha);
      clippedText(
        cv,
        innerX,
        innerW,
        cardY + 1,
        off,
        padTo(s.kind.toUpperCase(), 8),
        lift(kind, cardY + 1),
      );
      clippedText(
        cv,
        innerX,
        innerW,
        cardY + 1,
        off + 9,
        fit(s.text, innerW - 9),
        lift(PALETTE.white, cardY + 1),
      );
      const meta = [s.url ?? "", `calls so far: ${callsUpTo(cs, i)}`].filter(Boolean).join("  ·  ");
      clippedText(
        cv,
        innerX,
        innerW,
        cardY + 2,
        off,
        fit(meta, innerW),
        lift(PALETTE.slate, cardY + 2),
      );
    };
    if (p.slideFrom !== null && p.slideFrom < n && slideK < 0.97) {
      drawStep(p.slideFrom, -Math.round(innerW * slideK), 1 - slideK);
      drawStep(p.idx, Math.round(innerW * (1 - slideK)), slideK);
    } else {
      drawStep(p.idx, 0, 1);
    }
    // Re-assert the borders over any slid text that crossed them.
    for (let j = 1; j < cardH - 1; j++) {
      cv.put(2, cardY + j, "│", PALETTE.deep);
      cv.put(2 + cardW - 1, cardY + j, "│", PALETTE.deep);
      cv.put(3, cardY + j, " ", null);
      cv.put(2 + cardW - 2, cardY + j, " ", null);
    }
  }

  // Rows 7–11 — transcript (fades in).
  const upto = Math.min(p.idx, n - 1);
  const from = Math.max(0, upto - TRANSCRIPT_ROWS + 1);
  const rows = upto - from + 1;
  const y0 = 7 + (TRANSCRIPT_ROWS - rows);
  for (let i = from; i <= upto; i++) {
    const s = cs.steps[i];
    const y = y0 + (i - from);
    const seen = p.seenAt.get(i) ?? t;
    const a = ease.outCubic(clamp01((t - seen) / FADE_MS));
    const current = i === p.idx;
    const base: RGB = current ? KIND_COLOR[s.kind] : PALETTE.slate;
    const col = mixRgb(PALETTE.deep, base, a);
    cv.text(2, y, clock(elapsedAt(cs, i)), mixRgb(PALETTE.deep, PALETTE.slate, a));
    cv.text(11, y, padTo(s.kind, 8), col);
    cv.text(20, y, fit(s.text, width - 22), current ? mixRgb(PALETTE.deep, PALETTE.white, a) : col);
  }

  // Row 13 — controls.
  const controls = atEnd
    ? "enter continue  ·  ← back"
    : `← → step  ·  ${p.playing ? "space pause" : "space play"}  ·  enter finish  ·  esc skip`;
  cv.text(2, 13, controls, PALETTE.slate);

  return cv.render();
}

function drawJudge(
  cv: Canvas,
  p: Player,
  t: number,
  cardY: number,
  cardW: number,
  innerX: number,
  innerW: number,
): void {
  const { cs } = p;
  const pass = cs.verdict === "pass";
  const verdictColor = pass ? PALETTE.brand : PALETTE.rose;
  const since = t - (p.judgeAt ?? t);
  const border = since < FLASH_MS ? PALETTE.mint : mixRgb(PALETTE.deep, verdictColor, 0.6);
  box(cv, 2, cardY, cardW, 4, border, "judge");
  if (since < FLASH_MS) {
    // Flip flash: the content row inverts to solid mint for a beat.
    for (let x = innerX; x < innerX + innerW; x++) cv.put(x, cardY + 1, "█", PALETTE.mint);
    return;
  }
  const pulse =
    since < FLASH_MS + PULSE_MS
      ? (1 + Math.sin(((since - FLASH_MS) / PULSE_MS) * Math.PI * 4)) / 2
      : 0;
  const vc = mixRgb(verdictColor, PALETTE.white, pulse * 0.55);
  cv.text(innerX, cardY + 1, pass ? "✓ PASS" : "✗ FAIL", vc);
  cv.text(innerX + 8, cardY + 1, fit(cs.answer, innerW - 8), PALETTE.white);
  cv.text(innerX, cardY + 2, fit(`judge: ${cs.reason}`, innerW), PALETTE.slate);
}

// ─── The player loop ────────────────────────────────────────────────────

/** Resolves "done" when the trajectory has been read to the judge, "cancel" on Ctrl+C. */
async function play(cs: ScriptedCase, startIdx: number): Promise<"done" | "cancel"> {
  const width = canvasWidth();
  const n = cs.steps.length;

  if (!canAnimateInPlace()) {
    // Static: the whole transcript, then the judge.
    for (let i = 0; i < n; i++) {
      const s = cs.steps[i];
      process.stdout.write(
        `  ${clock(elapsedAt(cs, i))}  ${padTo(s.kind, 8)} ${fit(s.text, width - 22)}\n`,
      );
    }
    process.stdout.write("\n");
    const pass = cs.verdict === "pass";
    const inner = width - 8;
    for (const row of panel(
      [
        `${pass ? c.bbBold + "✓ PASS" : c.bold + c.red + "✗ FAIL"}${c.reset}  ${fit(cs.answer, inner - 8)}`,
        `${c.dim}judge: ${fit(cs.reason, inner - 7)}${c.reset}`,
      ],
      { title: "judge", width: inner, border: pass ? c.bb : c.gray },
    ))
      process.stdout.write(row + "\n");
    return "done";
  }

  const p = newPlayer(cs, startIdx, width);
  const block = new LiveBlock();
  return new Promise((resolve) => {
    let finished = false;
    let timer: NodeJS.Timeout | null = null;
    let doneAt: number | null = p.idx >= n ? nowMs() : null;

    const finish = (how: "done" | "cancel"): void => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      keys.release();
      p.playing = false;
      if (p.idx < n) goTo(p, n);
      p.judgeAt = p.judgeAt ?? nowMs() - FLASH_MS - PULSE_MS; // rest state, no flash
      block.paint(drawFrame(p, width, nowMs() + 1), { final: true });
      resolve(how);
    };

    const tick = (): void => {
      if (finished) return;
      const t = nowMs();
      // Autoplay advancement.
      if (p.playing && p.idx < n) {
        const step = cs.steps[p.idx];
        if (t - p.stepStartedAt >= Math.max(120, step.ms * PLAY_SPEED)) goTo(p, p.idx + 1);
      }
      if (p.idx >= n && doneAt === null) doneAt = t;
      if (p.idx < n) doneAt = null;
      if (
        doneAt !== null &&
        p.playing !== false &&
        t - doneAt >= END_DWELL_MS + FLASH_MS + PULSE_MS
      ) {
        finish("done");
        return;
      }
      block.paint(drawFrame(p, width, t));
      timer = setTimeout(tick, 1000 / FPS);
    };

    const keys = listenKeys((k) => {
      if (finished) return;
      switch (k.name) {
        case "ctrl-c":
          finish("cancel");
          return;
        case "escape":
        case "enter":
          if (p.idx >= n) finish("done");
          else {
            goTo(p, n);
            p.playing = true; // lets the judge dwell then auto-finish
          }
          return;
        case "right":
          goTo(p, Math.min(n, p.idx + 1));
          p.playing = false;
          p.frozenMs = elapsedAt(cs, p.idx - 1);
          return;
        case "left":
          goTo(p, Math.max(0, p.idx - 1));
          p.playing = false;
          p.frozenMs = elapsedAt(cs, p.idx - 1);
          return;
        case "space":
          if (p.idx >= n) return;
          p.playing = !p.playing;
          if (p.playing) {
            // Resume from where the clock froze within this step.
            const step = cs.steps[p.idx];
            const frac = clamp01((p.frozenMs - elapsedAt(cs, p.idx - 1)) / Math.max(1, step.ms));
            p.stepStartedAt = nowMs() - frac * Math.max(120, step.ms * PLAY_SPEED);
          } else {
            p.frozenMs = shownMs(p, nowMs());
          }
          return;
        default:
          return;
      }
    });
    tick();
  });
}

// ─── Flow ───────────────────────────────────────────────────────────────

export async function runTrace(ctx: WelcomeRunContext): Promise<WizardOutcome> {
  try {
    return await flow(ctx);
  } finally {
    setCursorHidden(false);
  }
}

function cancelled(): WizardOutcome {
  setCursorHidden(false);
  process.stdout.write(`\n  ${c.dim}(cancelled — we'll show this again next launch)${c.reset}\n\n`);
  return { status: "cancelled" };
}

/** Reveal pre-rendered rows top→bottom with a bright leading edge. */
async function wipeIn(rows: string[], signal: SkipSignal): Promise<void> {
  const block = new LiveBlock();
  if (!canAnimateInPlace() || signal.cancelled) {
    block.paint(rows, { final: true });
    return;
  }
  const plainRows = rows.map((r) => stripAnsi(r));
  await animate({
    durationMs: 500,
    signal,
    block,
    draw: (t) => {
      const k = ease.outCubic(t);
      const edge = k * rows.length;
      return rows.map((row, i) => {
        if (i + 1 <= edge) return row;
        if (i <= edge) {
          const a = edge - i; // partial row: bright edge
          return `${fg(mixRgb(PALETTE.brand, PALETTE.white, 0.6))}${plainRows[i].slice(0, Math.round(plainRows[i].length * a))}${c.reset}`;
        }
        return "";
      });
    },
  });
  block.paint(rows, { final: true });
}

async function flow(ctx: WelcomeRunContext): Promise<WizardOutcome> {
  const cs = loadScriptedCases()[1];
  const width = canvasWidth();
  setCursorHidden(true);

  // Shared intro first (it owns its keys); then our own skip listener for
  // the task card. Esc here → straight to the judge.
  const opening = await runIntro();
  if (opening.aborted) return cancelled();
  const intro = listenForSkip();
  let skipToEnd = false;
  try {
    ruleHeader("The task", { eyebrow: `webvoyager · ${cs.id}` });
    const inner = width - 8;
    const card = panel(
      [
        `${c.bb}${cs.site}${c.reset}  ${c.dim}${cs.startUrl}${c.reset}`,
        "",
        ...wrap(cs.task, inner),
      ],
      { title: "benchmark task", width: inner },
    );
    await wipeIn(card, intro.signal);
    await sleep(Math.min(1400, 160 * card.length), intro.signal);
    process.stdout.write("\n");
    if (intro.signal.aborted) return cancelled();
    skipToEnd = intro.signal.cancelled;
  } finally {
    intro.release();
  }

  // Segment 2: the player.
  ruleHeader("The trajectory", { eyebrow: "replay · ← → space" });
  const outcome = await play(cs, skipToEnd ? cs.steps.length : 0);
  if (outcome === "cancel") return cancelled();
  process.stdout.write("\n");

  // Segment 3: what you just read.
  const tail = listenForSkip();
  try {
    await revealLines(
      [
        `  ${c.dim}This is a trajectory — what a real run persists under${c.reset} ${c.bb}.trajectories/${c.reset}`,
        `  ${c.dim}and what${c.reset} ${c.bb}evals verify <dir>${c.reset} ${c.dim}re-scores without re-running the agent.${c.reset}`,
        `  ${c.gray}replay of a real benchmark task · timings illustrative${c.reset}`,
      ],
      { signal: tail.signal, msPerWord: READING_MS_PER_WORD, maxLineMs: 800 },
    );
    if (tail.signal.aborted) return cancelled();
  } finally {
    tail.release();
  }

  // The chip gets its own skip signal: an Esc pressed during the closing
  // lines fast-forwards *to* the call-to-action, it doesn't dismiss it.
  const machine = detectMachine();
  process.stdout.write(
    `\n${wrap(machine.recommend.line, width - 4)
      .map((l) => `  ${l}`)
      .join("\n")}\n`,
  );
  const chip = listenForSkip();
  let runNext: string | null = null;
  try {
    runNext = await handoffChip(machine.recommend.command ?? "list bench", chip.signal);
    if (chip.signal.aborted) return cancelled();
  } finally {
    chip.release();
  }

  markFirstRunComplete(ctx.entryDir);
  process.stdout.write(
    runNext
      ? `\n  ${c.bb}✓ Running ${runNext}…${c.reset}\n\n`
      : `\n  ${c.bb}✓ All set.${c.reset} ${c.dim}Try${c.reset} ${c.bb}help${c.reset} ${c.dim}or${c.reset} ${c.bb}evals doctor${c.reset} ${c.dim}anytime.${c.reset}\n\n`,
  );
  return { status: "completed", runNext };
}

/** Greedy word wrap to `width` visible columns, dim body text. */
function wrap(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    if (cur && visibleLength(cur) + 1 + w.length > width) {
      lines.push(cur);
      cur = w;
    } else cur = cur ? `${cur} ${w}` : w;
  }
  if (cur) lines.push(cur);
  return lines.map((l) => `${c.dim}${l}${c.reset}`);
}
