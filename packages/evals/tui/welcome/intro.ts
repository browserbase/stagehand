/**
 * Design d — Manifesto.
 *
 * The opposite bet from dashboards: pure typography. One idea per screen,
 * set big, replaced in place in a fixed region — never scrolled. Confidence
 * comes from words and REAL numbers (the live registry, the public board);
 * nothing is simulated and nothing runs.
 *
 * What moves is the type itself (fx engine, 24fps): letters assemble out of
 * a particle field, the three metric words take their color in a left→right
 * wipe, block digits flash mint on every tick while they count up, and each
 * screen is replaced by the next behind a column wipe.
 *
 * Metric colors are law: accuracy → brand green, speed → cyan, cost → amber.
 *
 * Input: ONE raw listener for the whole sequence (it doubles as the
 * SkipSignal every animation reads). Any key advances the screen, Esc jumps
 * to "start here", Ctrl+C cancels. Every screen auto-advances so nobody is
 * trapped.
 */

import {
  animate,
  Canvas,
  drawParticles,
  ease,
  METRIC,
  mixRgb,
  PALETTE,
  ramp,
  seeded,
  spawnParticles,
  stepParticles,
  type Particle,
} from "../fx.js";
import {
  canAnimateInPlace,
  listenKeys,
  LiveBlock,
  setCursorHidden,
  sleep,
  type RGB,
  type SkipSignal,
} from "../wizardAnim.js";
import { createBootRenderer } from "./boot.js";
import {
  LEADERBOARD,
  LEADERBOARD_AS_OF,
  LEADERBOARD_BENCHMARK,
  LEADERBOARD_URL,
} from "./leaderboard.js";
import { SHADOW_GLYPHS, shadowText } from "./shadowFont.js";

const ROWS = 16;
/** Region width: as wide as the terminal allows between 72 and 96 columns. */
const MEASURE = Math.max(72, Math.min((process.stdout.columns ?? 80) - 4, 96));
const DWELL_MS = 1900;
const WIPE_MS = 480;
const FPS = 24;

// ─── Text helpers ───────────────────────────────────────────────────────

/** Letter-space a phrase: chars joined by one space, words by three. */
function spaced(text: string): string {
  return text
    .toUpperCase()
    .split(" ")
    .map((w) => Array.from(w).join(" "))
    .join("   ");
}

/** Greedy wrap of a letter-spaced phrase (words separated by 3 spaces). */
function wrapSpaced(text: string, width: number): string[] {
  const words = text.split("   ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur}   ${w}` : w;
    if (next.length > width && cur) {
      lines.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}

const cx = (len: number): number => Math.floor((MEASURE - len) / 2);

/** Blank a horizontal span (one cell of margin each side) so ambient particles never sit inside type. */
function clearSpan(cv: Canvas, x: number, y: number, len: number): void {
  for (let i = x - 1; i < x + len + 1; i++) cv.put(i, y, " ", null);
}

function centered(cv: Canvas, y: number, text: string, color: RGB | null): void {
  const len = Array.from(text).length;
  clearSpan(cv, cx(len), y, len);
  cv.text(cx(len), y, text, color);
}

/** A rule of `len` cells growing outward from the center. */
function rule(cv: Canvas, y: number, len: number, color: RGB): void {
  const full = 40;
  const half = Math.round((Math.min(1, len) * full) / 2);
  const mid = MEASURE / 2;
  for (let x = Math.floor(mid - half); x < Math.floor(mid + half); x++) cv.put(x, y, "━", color);
}

// ─── Input ──────────────────────────────────────────────────────────────

/** Input state shared by every screen; doubles as a SkipSignal for `sleep`/`animate`. */
class Keys implements SkipSignal {
  advance = false;
  skipAll = false;
  aborted = false;
  get cancelled(): boolean {
    return this.advance || this.skipAll || this.aborted;
  }
  set cancelled(_v: boolean) {
    /* read-only view */
  }
  reset(): void {
    this.advance = false;
  }
}

// ─── Screens ────────────────────────────────────────────────────────────

// ─── Block type ─────────────────────────────────────────────────────────

/** Six visible rows of ANSI Shadow (the seventh is blank). */
const BLOCK_ROWS = 6;

type BlockLetter = { x: number; rows: string[]; width: number };

/** Lay out `text` in the block face: per-letter glyphs with x offsets, so letters can animate independently. */
function blockLetters(text: string): { letters: BlockLetter[]; width: number } {
  const letters: BlockLetter[] = [];
  let x = 0;
  for (const ch of text.toUpperCase()) {
    const g = SHADOW_GLYPHS[ch];
    if (!g) continue;
    const width = Math.max(...g.map((r) => r.length));
    letters.push({ x, rows: g.slice(0, BLOCK_ROWS).map((r) => r.padEnd(width)), width });
    x += width;
  }
  return { letters, width: x };
}

/** Paint one block letter at (x0, y0) with a vertical offset (fractional rows are clipped, not blended). */
function putLetter(
  cv: Canvas,
  letter: BlockLetter,
  x0: number,
  y0: number,
  dy: number,
  color: RGB,
): void {
  const yStart = Math.round(y0 + dy);
  letter.rows.forEach((row, r) => {
    Array.from(row).forEach((ch, col) => {
      if (ch !== " ") cv.put(x0 + letter.x + col, yStart + r, ch, color);
    });
  });
}

/**
 * Letters drop in one after another from above, overshooting (outBack) and
 * warming from `from` to `to`. `t` is 0→1 over the whole word.
 */
function dropWord(
  cv: Canvas,
  word: ReturnType<typeof blockLetters>,
  x0: number,
  y0: number,
  t: number,
  from: RGB,
  to: RGB,
  stagger = 0.07,
  dur = 0.42,
): void {
  word.letters.forEach((letter, i) => {
    const local = (t - i * stagger) / dur;
    if (local <= 0) return;
    const p = Math.min(1, local);
    const k = ease.outBack(p);
    putLetter(cv, letter, x0, y0, -(1 - k) * 3, mixRgb(from, to, Math.min(1, p * 1.4)));
  });
}

/** The Stagehand mark: a green square carrying a white S from the same face. */
const MARK_W = 14;
const MARK_H = 7;
function putMark(cv: Canvas, x0: number, y0: number, alpha: number, sweep: number | null): void {
  const green = mixRgb(PALETTE.void, PALETTE.brand, alpha);
  for (let y = 0; y < MARK_H; y++) {
    for (let x = 0; x < MARK_W; x++) {
      let g = green;
      if (sweep !== null) {
        const d = Math.abs(x0 + x - sweep) / 6;
        if (d < 1) g = mixRgb(g, PALETTE.white, (1 - d) * 0.3);
      }
      cv.put(x0 + x, y0 + y, " ", null, g);
    }
  }
  const S = SHADOW_GLYPHS["S"].slice(0, BLOCK_ROWS);
  const sw = Math.max(...S.map((r) => r.length));
  const sx = x0 + Math.floor((MARK_W - sw) / 2);
  const white = mixRgb(PALETTE.void, PALETTE.white, alpha);
  S.forEach((row, r) => {
    Array.from(row).forEach((ch, col) => {
      if (ch !== " ") cv.put(sx + col, y0 + r, ch, white, green);
    });
  });
}

type Screen = {
  /** Animated build of the screen; `t` is 0→1 over `buildMs`. */
  draw: (t: number, now: number) => Canvas;
  buildMs: number;
  /** Optional ambient draw for the dwell (particles, glow decay). */
  idle?: (t: number, now: number) => Canvas;
  /** Hold after the build; defaults to DWELL_MS. */
  dwellMs?: number;
};

/** Crossfade: the new screen's ink warms in from the dark while the old screen's cools out. */
function composite(oldCv: Canvas, newCv: Canvas, t: number): Canvas {
  const cv = new Canvas(MEASURE, ROWS);
  const k = ease.inOutSine(t);
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < MEASURE; x++) {
      const ng = newCv.glyphs[y][x];
      const nbg = newCv.bgs[y][x];
      if (ng !== " " || nbg) {
        cv.put(
          x,
          y,
          ng,
          mixRgb(PALETTE.void, newCv.colors[y][x] ?? PALETTE.white, k),
          nbg ? mixRgb(PALETTE.void, nbg, k) : null,
        );
        continue;
      }
      const og = oldCv.glyphs[y][x];
      const obg = oldCv.bgs[y][x];
      if (og !== " " || obg) {
        cv.put(
          x,
          y,
          og,
          mixRgb(PALETTE.void, oldCv.colors[y][x] ?? PALETTE.white, 1 - k),
          obg ? mixRgb(PALETTE.void, obg, 1 - k) : null,
        );
      }
    }
  }
  return cv;
}

/** How the intro ended. `skipped` = Esc (the caller should start its content right away). */
export type IntroOutcome = { aborted: boolean; skipped: boolean };

/**
 * The shared opening every design plays before its own content:
 * logo → statement → the three measures → top of the board. Owns its keys
 * (any key advances, Esc skips the rest, Ctrl+C aborts). Leaves the cursor
 * hidden — callers restore it in their own finally.
 */
export async function runIntro(): Promise<IntroOutcome> {
  setCursorHidden(true);
  return flow();
}

async function flow(): Promise<IntroOutcome> {
  const live = canAnimateInPlace();
  const keys = new Keys();
  const input = listenKeys((k) => {
    if (k.name === "ctrl-c") keys.aborted = true;
    else if (k.name === "escape") keys.skipAll = true;
    else keys.advance = true;
  });
  const rand = seeded(0x4d41);
  const region = new LiveBlock();
  let shown: Canvas | null = null;

  const cancelled = (): IntroOutcome => ({ aborted: true, skipped: false });

  /** Wipe to the screen's first frame, play its build, hold with idle motion. */
  const play = async (screen: Screen): Promise<void> => {
    keys.reset();
    const start = Date.now();
    const first = screen.draw(0, start);
    if (live && shown && !keys.cancelled) {
      const old = shown;
      await animate({
        durationMs: WIPE_MS,
        fps: FPS,
        signal: keys,
        block: region,
        draw: (t) => composite(old, first, t).render(),
      });
    }
    await animate({
      durationMs: screen.buildMs,
      fps: FPS,
      signal: keys,
      block: region,
      draw: (t) => screen.draw(t, Date.now()).render(),
    });
    const settled = screen.draw(1, Date.now());
    region.paint(settled.render(), { final: true });
    shown = settled;
    // Off-TTY every screen is a static print — no dwell, no wipe.
    if (!live || keys.aborted || keys.skipAll) return;
    keys.reset();
    const dwell = screen.dwellMs ?? DWELL_MS;
    if (screen.idle && live) {
      await animate({
        durationMs: dwell,
        fps: FPS,
        signal: keys,
        block: region,
        draw: (t) => screen.idle!(t, Date.now()).render(),
      });
      shown = screen.idle(1, Date.now());
      region.paint(shown.render());
    } else {
      await sleep(dwell, keys);
    }
    keys.reset();
  };

  try {
    // ── 0. brand — the mark fades up, STAGEHAND drops in letter by letter ──
    if (!keys.skipAll) {
      const word = blockLetters("STAGEHAND");
      const gap = 3;
      const sideBySide = MEASURE >= MARK_W + gap + word.width + 2;
      const markX = sideBySide ? cx(MARK_W + gap + word.width) : cx(MARK_W);
      const markY = sideBySide ? Math.floor((ROWS - MARK_H) / 2) : 1;
      const wordX = sideBySide ? markX + MARK_W + gap : cx(word.width);
      const wordY = sideBySide ? markY : markY + MARK_H + 2;
      await play({
        buildMs: 1700,
        draw: (t) => {
          const cv = new Canvas(MEASURE, ROWS);
          const sweep = t > 0.78 ? -8 + (MEASURE + 16) * ease.inOutSine((t - 0.78) / 0.22) : null;
          putMark(cv, markX, markY, ease.outCubic(Math.min(1, t / 0.4)), sweep);
          dropWord(cv, word, wordX, wordY, (t - 0.2) / 0.6, PALETTE.deep, PALETTE.white);
          if (sweep !== null) {
            for (const letter of word.letters) {
              const d = Math.abs(wordX + letter.x + letter.width / 2 - sweep) / 8;
              if (d < 1)
                putLetter(
                  cv,
                  letter,
                  wordX,
                  wordY,
                  0,
                  mixRgb(PALETTE.white, PALETTE.mint, (1 - d) * 0.6),
                );
            }
          }
          return cv;
        },
        dwellMs: 1200,
      });
      if (keys.aborted) return cancelled();
    }

    // ── 1. statement — letters assemble out of the field ────────────────
    if (!keys.skipAll) {
      const lines = wrapSpaced(
        spaced("Your agent should be able to use a browser like you do."),
        MEASURE - 4,
      );
      const y0 = Math.floor((ROWS - (lines.length * 2 - 1)) / 2);
      type Letter = { tx: number; ty: number; sx: number; sy: number; delay: number; ch: string };
      const letters: Letter[] = [];
      lines.forEach((line, i) => {
        const x0 = cx(line.length);
        Array.from(line).forEach((ch, col) => {
          if (ch === " ") return;
          letters.push({
            tx: x0 + col,
            ty: y0 + i * 2,
            sx: rand() * MEASURE,
            sy: rand() < 0.5 ? -2 - rand() * 3 : ROWS + 1 + rand() * 3,
            delay: (col / line.length) * 0.5 + i * 0.1 + rand() * 0.08,
            ch,
          });
        });
      });
      const ruleTop = y0 - 3;
      const ruleBottom = y0 + lines.length * 2 + 1;
      await play({
        buildMs: 1600,
        draw: (t) => {
          const cv = new Canvas(MEASURE, ROWS);
          const r = ease.outCubic(t / 0.6);
          rule(cv, ruleTop, r, PALETTE.brand);
          rule(cv, ruleBottom, r, PALETTE.brand);
          for (const l of letters) {
            const local = t - l.delay * 0.55;
            if (local <= 0) continue;
            const p = ease.outCubic(Math.min(1, local / 0.42));
            const x = l.sx + (l.tx - l.sx) * p;
            const y = l.sy + (l.ty - l.sy) * p;
            cv.put(
              x,
              y,
              p < 0.3 ? "▪" : l.ch,
              ramp([PALETTE.teal, PALETTE.brand, PALETTE.white], p),
            );
          }
          return cv;
        },
      });
    }
    if (keys.aborted) return cancelled();

    // ── 2. three measures — each lands big in its color, then collapses ───
    if (!keys.skipAll) {
      const measures: Array<{ word: string; def: string; color: RGB }> = [
        { word: "accuracy", def: "did the agent finish the task", color: METRIC.accuracy },
        { word: "speed", def: "how long it took", color: METRIC.speed },
        { word: "cost", def: "what the model calls cost", color: METRIC.cost },
      ];
      const blocks = measures.map((m) => blockLetters(m.word));
      const header = spaced("we measure three things");
      const BIG_Y = 2;
      const DEF_Y = BIG_Y + BLOCK_ROWS + 1;
      const SMALL_Y = [11, 12, 13];
      const SLOT = 1 / measures.length;
      const particles: Particle[] = spawnParticles(24, MEASURE, ROWS, rand);
      let ptime = 0;
      let plast = 0;
      const smallLine = (m: (typeof measures)[number]): string => `${spaced(m.word)}   ${m.def}`;
      const drawMeasures = (cv: Canvas, t: number): void => {
        centered(cv, 0, header, PALETTE.slate);
        measures.forEach((m, i) => {
          const local = (t - i * SLOT) / SLOT; // 0→1 over this measure's slot
          if (local <= 0) return;
          const word = blocks[i];
          const x0 = cx(word.width);
          if (local < 0.62) {
            // land big
            dropWord(cv, word, x0, BIG_Y, local / 0.5, PALETTE.deep, m.color);
            const fade = Math.max(0, Math.min(1, (local - 0.3) / 0.25));
            if (fade > 0) centered(cv, DEF_Y, m.def, mixRgb(PALETTE.void, PALETTE.slate, fade));
          } else if (local < 1) {
            // collapse: big cools out while the small line warms in at its resting row
            const k = ease.inOutSine((local - 0.62) / 0.38);
            dropWord(cv, word, x0, BIG_Y, 1, PALETTE.deep, mixRgb(m.color, PALETTE.void, k));
            centered(cv, DEF_Y, m.def, mixRgb(PALETTE.slate, PALETTE.void, k));
            const line = smallLine(m);
            const lx = cx(line.length);
            Array.from(line).forEach((ch, col) => {
              if (ch === " ") return;
              const isWord = col < spaced(m.word).length;
              cv.put(
                lx + col,
                SMALL_Y[i],
                ch,
                mixRgb(PALETTE.void, isWord ? m.color : PALETTE.slate, k),
              );
            });
          } else {
            const line = smallLine(m);
            const lx = cx(line.length);
            Array.from(line).forEach((ch, col) => {
              if (ch === " ") return;
              const isWord = col < spaced(m.word).length;
              cv.put(lx + col, SMALL_Y[i], ch, isWord ? m.color : PALETTE.slate);
            });
          }
        });
      };
      await play({
        buildMs: 5400,
        draw: (t) => {
          const cv = new Canvas(MEASURE, ROWS);
          drawMeasures(cv, t);
          return cv;
        },
        idle: (t, now) => {
          const cv = new Canvas(MEASURE, ROWS);
          const dt = plast ? (now - plast) / 1000 : 0;
          plast = now;
          ptime += dt;
          stepParticles(particles, dt, MEASURE, ROWS, ptime);
          drawParticles(cv, particles, 0.22 * Math.min(1, t * 4));
          drawMeasures(cv, 1);
          return cv;
        },
        dwellMs: 1400,
      });
    }
    if (keys.aborted) return cancelled();

    // ── 4. top of the board — rushes in, settles, glows ────────────────
    if (!keys.skipAll) {
      const top = LEADERBOARD[0];
      let settledAt = 0;
      const drawBoard = (cv: Canvas, t: number, now: number): void => {
        centered(cv, 1, spaced("top of the board today"), PALETTE.slate);
        const k = ease.outExpo(t);
        const value = `${(top.accuracy * k).toFixed(1)}%`;
        if (t >= 1 && !settledAt) settledAt = now;
        const flash = settledAt ? Math.max(0, 1 - (now - settledAt) / 450) : 0;
        const color = mixRgb(METRIC.accuracy, PALETTE.mint, Math.max(flash, 0.15 * (1 - k)));
        const digits = shadowText(value).slice(0, BLOCK_ROWS);
        const x0 = cx(digits[0].length);
        digits.forEach((r, i) => cv.text(x0, 3 + i, r, color));
        const sub = Math.max(0, Math.min(1, (t - 0.7) / 0.3));
        if (sub > 0) {
          centered(cv, 3 + BLOCK_ROWS + 1, top.model, mixRgb(PALETTE.void, PALETTE.white, sub));
          centered(
            cv,
            3 + BLOCK_ROWS + 2,
            `${LEADERBOARD_BENCHMARK} · ${LEADERBOARD_URL} · ${LEADERBOARD_AS_OF}`,
            mixRgb(PALETTE.void, PALETTE.slate, sub),
          );
        }
      };
      await play({
        buildMs: 1700,
        draw: (t, now) => {
          const cv = new Canvas(MEASURE, ROWS);
          drawBoard(cv, t, now);
          return cv;
        },
        idle: (_t, now) => {
          const cv = new Canvas(MEASURE, ROWS);
          drawBoard(cv, 1, now);
          return cv;
        },
      });
    }
    if (keys.aborted) return cancelled();

    // ── finale: the mark assembles in the same slot and stays put ───────
    // An earlier Esc still lands here — the player then paints the settled
    // logo instantly, so the design below always has its header.
    {
      const boot = createBootRenderer({ width: MEASURE, height: ROWS, seed: 0x5747 });
      await play({ buildMs: boot.durationMs, draw: (t) => boot.draw(t), dwellMs: 700 });
    }
    process.stdout.write("\n");
    return { aborted: keys.aborted, skipped: keys.skipAll };
  } finally {
    input.release();
  }
}
