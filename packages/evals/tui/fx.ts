/**
 * fx — real animation primitives for the welcome flows.
 *
 * Where wizardAnim.ts does *reveals* (rows appearing, bars filling), this
 * module does *motion*: a frame loop with easing, a 2D cell canvas with a
 * color per cell, depth-sorted particles, and a semantic palette. Console-
 * boot energy — things move through space, glow, settle.
 *
 * Palette semantics (used identically by every flow so the colors teach):
 *   accuracy → brand green · speed → cyan · cost → amber · fail → rose
 */

import { c } from "./format.js";
import { canAnimateInPlace, LiveBlock, sleep, type RGB, type SkipSignal } from "./wizardAnim.js";

// ─── Palette ───────────────────────────────────────────────────────────

export const PALETTE = {
  void: [4, 16, 12] as RGB,
  deep: [8, 58, 42] as RGB,
  teal: [0, 148, 128] as RGB,
  brand: [1, 200, 81] as RGB,
  mint: [180, 255, 210] as RGB,
  white: [236, 255, 243] as RGB,
  cyan: [72, 198, 232] as RGB,
  amber: [255, 178, 64] as RGB,
  rose: [255, 98, 112] as RGB,
  slate: [118, 130, 126] as RGB,
} as const;

/** One color per public metric — never swap these between flows. */
export const METRIC = {
  accuracy: PALETTE.brand,
  speed: PALETTE.cyan,
  cost: PALETTE.amber,
} as const;

export function fg(color: RGB): string {
  return `\x1b[38;2;${color[0]};${color[1]};${color[2]}m`;
}
export function bg(color: RGB): string {
  return `\x1b[48;2;${color[0]};${color[1]};${color[2]}m`;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
export function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp01(t);
  return [
    Math.round(lerp(a[0], b[0], k)),
    Math.round(lerp(a[1], b[1], k)),
    Math.round(lerp(a[2], b[2], k)),
  ];
}

/** Multi-stop gradient: t in [0,1] across `stops`. */
export function ramp(stops: readonly RGB[], t: number): RGB {
  const k = clamp01(t) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(k));
  return mixRgb(stops[i], stops[i + 1], k - i);
}

/** Intensity 0→1 through the brand glow: void → deep → teal → brand → mint → white. */
export const GLOW: readonly RGB[] = [
  PALETTE.void,
  PALETTE.deep,
  PALETTE.teal,
  PALETTE.brand,
  PALETTE.mint,
  PALETTE.white,
];

// ─── Easing ────────────────────────────────────────────────────────────

export const ease = {
  linear: (t: number): number => t,
  outCubic: (t: number): number => 1 - Math.pow(1 - clamp01(t), 3),
  inOutSine: (t: number): number => -(Math.cos(Math.PI * clamp01(t)) - 1) / 2,
  outBack: (t: number): number => {
    const k = clamp01(t);
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
  },
  outExpo: (t: number): number => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(t))),
};

// ─── Canvas ────────────────────────────────────────────────────────────

/**
 * A width×height grid of (glyph, color) cells that renders to ANSI rows,
 * merging adjacent cells of equal color so frames stay small. Coordinates
 * are 0-based, x → column, y → row. Out-of-bounds writes are ignored.
 */
export class Canvas {
  readonly glyphs: string[][];
  readonly colors: (RGB | null)[][];
  /** Optional background per cell — lets half-block glyphs carry two pixels. */
  readonly bgs: (RGB | null)[][];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.glyphs = Array.from({ length: height }, () => Array(width).fill(" "));
    this.colors = Array.from({ length: height }, () => Array(width).fill(null));
    this.bgs = Array.from({ length: height }, () => Array(width).fill(null));
  }

  clear(): void {
    for (let y = 0; y < this.height; y++) {
      this.glyphs[y].fill(" ");
      this.colors[y].fill(null);
      this.bgs[y].fill(null);
    }
  }

  put(x: number, y: number, glyph: string, color: RGB | null, bgColor: RGB | null = null): void {
    const xi = Math.round(x);
    const yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= this.width || yi >= this.height) return;
    this.glyphs[yi][xi] = glyph;
    this.colors[yi][xi] = color;
    this.bgs[yi][xi] = bgColor;
  }

  /** Write a string left→right starting at (x,y) in one color. */
  text(x: number, y: number, s: string, color: RGB | null): void {
    let i = 0;
    for (const ch of s) {
      this.put(x + i, y, ch, color);
      i++;
    }
  }

  render(): string[] {
    const rows: string[] = [];
    for (let y = 0; y < this.height; y++) {
      let out = "";
      let last: string | null = null;
      for (let x = 0; x < this.width; x++) {
        const col = this.colors[y][x];
        const back = this.bgs[y][x];
        const code = (col ? fg(col) : "") + (back ? bg(back) : "");
        if (code !== last) {
          // A change of color always resets first so a dropped bg never bleeds.
          out += c.reset + code;
          last = code;
        }
        out += this.glyphs[y][x];
      }
      rows.push(out.replace(/\s+$/, "") + c.reset);
    }
    return rows;
  }
}

/** Glyph for a 0→1 intensity: nothing, then dots, then blocks. */
export function glowGlyph(intensity: number): string {
  const k = clamp01(intensity);
  if (k < 0.08) return " ";
  if (k < 0.22) return "·";
  if (k < 0.4) return "∙";
  if (k < 0.6) return "•";
  if (k < 0.8) return "▪";
  return "■";
}

/** Vertical fill glyph for a 0→1 fraction (bottom-up eighths). */
export function fillGlyph(frac: number): string {
  const k = clamp01(frac);
  const blocks = " ▁▂▃▄▅▆▇█";
  return blocks[Math.round(k * 8)];
}

// ─── Frame loop ────────────────────────────────────────────────────────

/**
 * Run `draw(t)` for `durationMs` at `fps` and paint each frame through
 * `block`. `t` is 0→1 linear; apply `ease.*` inside draw. Stops early when
 * the signal flips (the caller paints its own final frame). Returns the
 * number of frames painted. Off-TTY / narrow: paints nothing (caller
 * paints the resting frame with `{ final: true }`).
 */
export async function animate(opts: {
  durationMs: number;
  fps?: number;
  signal?: SkipSignal;
  block: LiveBlock;
  draw: (t: number, frame: number) => string[];
}): Promise<number> {
  const { durationMs, fps = 24, signal, block, draw } = opts;
  if (!canAnimateInPlace() || signal?.cancelled) return 0;
  const frameMs = 1000 / fps;
  const started = Date.now();
  let frame = 0;
  for (;;) {
    if (signal?.cancelled) break;
    const elapsed = Date.now() - started;
    const t = Math.min(1, elapsed / durationMs);
    block.paint(draw(t, frame));
    frame++;
    if (t >= 1) break;
    const drift = Date.now() - started - frame * frameMs;
    await sleep(Math.max(8, frameMs - drift), signal);
  }
  return frame;
}

// ─── Particles ─────────────────────────────────────────────────────────

export type Particle = {
  x: number;
  y: number;
  /** Depth 0 (far, dim, slow) → 1 (near, bright, fast). */
  z: number;
  vx: number;
  vy: number;
  /** Per-particle phase for sway. */
  phase: number;
};

/** Deterministic PRNG so the boot looks identical every launch. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0xffffffff;
  };
}

export function spawnParticles(
  n: number,
  width: number,
  height: number,
  rand: () => number,
): Particle[] {
  return Array.from({ length: n }, () => {
    const z = rand();
    return {
      x: rand() * width,
      y: rand() * height,
      z,
      vx: (rand() - 0.5) * 0.4 * (0.4 + z),
      vy: -(0.15 + 0.7 * z),
      phase: rand() * Math.PI * 2,
    };
  });
}

/** Advance particles by dt seconds; wrap vertically so the field never empties. */
export function stepParticles(
  ps: Particle[],
  dt: number,
  width: number,
  height: number,
  time: number,
): void {
  for (const p of ps) {
    p.x += (p.vx + Math.sin(time * 0.8 + p.phase) * 0.25 * p.z) * dt * 6;
    p.y += p.vy * dt * 3;
    if (p.y < -1) {
      p.y = height + 0.5;
      p.x = ((p.x % width) + width) % width;
    }
    if (p.x < 0) p.x += width;
    if (p.x >= width) p.x -= width;
  }
}

/** Draw particles: far ones are faint teal dots, near ones bright mint blocks. */
export function drawParticles(cv: Canvas, ps: Particle[], alpha = 1): void {
  for (const p of ps) {
    const intensity = (0.15 + 0.85 * p.z) * alpha;
    if (intensity < 0.06) continue;
    cv.put(p.x, p.y, glowGlyph(intensity), ramp(GLOW, 0.25 + 0.65 * intensity));
  }
}
