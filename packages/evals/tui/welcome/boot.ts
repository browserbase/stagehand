/**
 * The boot sequence — the shared opening of every welcome flow.
 *
 * A dark field with a little drifting dust; the EVALS glyphs assemble out
 * of it — each cell is a particle that eases into place, warming from teal
 * to brand green as it lands — a light sweeps across the mark, the dust
 * fades, and the logo settles as ordinary scrollback text. ~3.4s, Esc-
 * skippable at any frame, a static banner off-TTY.
 */

import { c } from "../format.js";
import { BANNER_W, printBanner } from "../banner.js";
import {
  Canvas,
  drawParticles,
  ease,
  animate,
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
  center,
  LiveBlock,
  sleep,
  termSize,
  typeline,
  type SkipSignal,
} from "../wizardAnim.js";

const BANNER_LINES = [
  "███████╗██╗   ██╗ █████╗ ██╗     ███████╗",
  "██╔════╝██║   ██║██╔══██╗██║     ██╔════╝",
  "█████╗  ██║   ██║███████║██║     ███████╗",
  "██╔══╝  ╚██╗ ██╔╝██╔══██║██║     ╚════██║",
  "███████╗ ╚████╔╝ ██║  ██║███████╗███████║",
  "╚══════╝  ╚═══╝  ╚═╝  ╚═╝╚══════╝╚══════╝",
];

const HEIGHT = 12;
const DURATION_MS = 3400;
/** Phase boundaries as fractions of the whole. */
const T_ASSEMBLE_START = 0.1;
const T_ASSEMBLE_END = 0.72;
const T_SWEEP_END = 0.92;

type Cell = { tx: number; ty: number; sx: number; sy: number; delay: number; ch: string };

function buildCells(
  originX: number,
  originY: number,
  rand: () => number,
  width: number,
  height: number,
): Cell[] {
  const cells: Cell[] = [];
  BANNER_LINES.forEach((line, row) => {
    Array.from(line).forEach((ch, col) => {
      if (ch === " ") return;
      cells.push({
        tx: originX + col,
        ty: originY + row,
        // Converge from everywhere — the previous screen collapses into the mark.
        sx: rand() * width,
        sy: rand() * height,
        delay: (col / BANNER_W) * 0.55 + rand() * 0.15, // left→right stagger
        ch,
      });
    });
  });
  return cells;
}

/**
 * Frame renderer for the logo assembly, usable inside any fixed region: the
 * intro plays it as its final screen; `bootSequence` wraps it standalone.
 * `draw(t)` returns the Canvas for t∈[0,1]; `final()` the settled mark.
 */
export function createBootRenderer(opts: { width: number; height: number; seed?: number }): {
  draw: (t: number) => Canvas;
  final: () => Canvas;
  durationMs: number;
} {
  const { width, height } = opts;
  const originX = Math.floor((width - BANNER_W) / 2);
  const originY = Math.floor((height - BANNER_LINES.length) / 2);
  const rand = seeded(opts.seed ?? 0x5747);
  const particles: Particle[] = spawnParticles(Math.round(width * 0.35), width, height, rand);
  const cells = buildCells(originX, originY, rand, width, height);
  let lastT = 0;
  let time = 0;
  const HEIGHT = height;
  const draw = (t: number): Canvas => {
    const dt = Math.max(0, t - lastT) * (DURATION_MS / 1000);
    lastT = t;
    time += dt;
    const cv = new Canvas(width, HEIGHT);

    // Field: fades out as the mark assembles.
    const fieldAlpha =
      1 - ease.inOutSine((t - T_ASSEMBLE_START) / (T_ASSEMBLE_END - T_ASSEMBLE_START));
    stepParticles(particles, dt, width, HEIGHT, time);
    if (fieldAlpha > 0.1) {
      drawParticles(cv, particles, fieldAlpha);
    }

    // Assembly: each glyph eases from its spawn point to its home.
    if (t > T_ASSEMBLE_START) {
      const span = T_ASSEMBLE_END - T_ASSEMBLE_START;
      for (const cell of cells) {
        const local = (t - T_ASSEMBLE_START) / span - cell.delay;
        if (local <= 0) continue;
        const p = ease.outCubic(Math.min(1, local / 0.45));
        const x = cell.sx + (cell.tx - cell.sx) * p;
        const y = cell.sy + (cell.ty - cell.sy) * p;
        const color = ramp([PALETTE.teal, PALETTE.brand, PALETTE.mint], p * 0.85);
        cv.put(x, y, p < 0.35 ? "▪" : cell.ch, color);
      }
    }

    // Light sweep across the settled mark, then cool to brand green.
    if (t > T_ASSEMBLE_END) {
      const s = (t - T_ASSEMBLE_END) / (T_SWEEP_END - T_ASSEMBLE_END);
      const sweepX = originX - 8 + (BANNER_W + 16) * Math.min(1, s);
      for (const cell of cells) {
        const d = Math.abs(cell.tx - sweepX) / 7;
        const glow = d < 1 ? (1 - d) * 0.9 : 0;
        const cool = t > T_SWEEP_END ? 1 : 0;
        cv.put(
          cell.tx,
          cell.ty,
          cell.ch,
          mixRgb(mixRgb(PALETTE.brand, PALETTE.mint, 0.15 * (1 - cool)), PALETTE.white, glow),
        );
      }
    }
    return cv;
  };
  const final = (): Canvas => {
    const cv = new Canvas(width, height);
    BANNER_LINES.forEach((line, row) => cv.text(originX, originY + row, line, PALETTE.brand));
    return cv;
  };
  return { draw, final, durationMs: DURATION_MS };
}

export async function bootSequence(
  opts: { signal?: SkipSignal; tagline?: string; hint?: string } = {},
): Promise<void> {
  const { signal, tagline, hint } = opts;
  const cols = termSize().cols;
  const width = Math.max(48, Math.min(cols - 2, 96));
  const r = createBootRenderer({ width, height: HEIGHT });

  if (!canAnimateInPlace() || signal?.cancelled) {
    printBanner();
  } else {
    const block = new LiveBlock();
    process.stdout.write("\n");
    await animate({
      durationMs: r.durationMs,
      fps: 24,
      signal,
      block,
      draw: (t) => r.draw(t).render(),
    });
    block.paint(
      r
        .final()
        .render()
        .map((row) => `${c.bold}${row}`),
      { final: true },
    );
    process.stdout.write("\n");
  }

  if (tagline) {
    await sleep(120, signal);
    await typeline(center(`${c.dim}${tagline}${c.reset}`, width), { msPerChar: 16, signal });
  }
  if (hint) process.stdout.write(center(`${c.dim}${hint}${c.reset}`, width) + "\n");
  process.stdout.write("\n");
}
